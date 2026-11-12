'use strict';
/* =====================================================================
 *  EJECUCIÓN  (usa el AST ya validado por el análisis semántico)
 *  Calcula el resultado de  evaluar(expresión)  y ejecuta  print(...).
 *
 *  Es un "intérprete de árbol": recorre el AST y ejecuta cada nodo.
 *   - ev(nodo, entorno)   evalúa una expresión y devuelve su valor.
 *   - exec(nodo, entorno) ejecuta una instrucción.
 *   - Entorno (Env): tabla de variables de un bloque, enlazada con la del bloque
 *     que lo contiene, para que un bloque vea las variables de afuera.
 *   - break / continue / return / throw se implementan con "señales" (excepciones
 *     internas) que el ciclo, la función o el try correspondiente atrapa.
 *
 *  run(ast, types, source) -> { outputs, error }
 *    outputs: [{ kind: 'evaluar'|'print', line, text, value }]
 *    error  : null o { message, line, column }  (error al ejecutar)
 * ===================================================================== */
(function () {
  const MAX_STEPS = 300000;
  const INT_TYPES = new Set(['int', 'short', 'long']);
  const FLOAT_TYPES = new Set(['float', 'double']);

  class RuntimeError extends Error {
    constructor(message, node) { super(message); this.node = node; }
  }
  // Señales de control de flujo (no son errores del programa)
  class BreakSig {}
  class ContinueSig {}
  class ReturnSig { constructor(v) { this.value = v; } }
  class ThrowSig { constructor(v, node) { this.value = v; this.node = node; } }

  const NO_CLASES = 'Las clases todavía no se pueden ejecutar.';
  const posOf = (node) => ({ line: node && node.loc ? node.loc.line : 1, column: node && node.loc ? node.loc.column : 1 });

  class Env {
    constructor(parent) { this.vars = new Map(); this.parent = parent; }
    find(name) { for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e; return null; }
  }

  function defaultFor(t) {
    if (INT_TYPES.has(t) || FLOAT_TYPES.has(t)) return 0;
    if (t === 'bool' || t === 'boolean') return false;
    if (t === 'string' || t === 'char') return '';
    return undefined;
  }

  // Muestra un valor como lo vería una persona: 5.0 para float entero, textos sin comillas.
  // 'top' es true para el valor principal; dentro de arreglos y objetos los textos llevan comillas.
  function format(v, type, top) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return String(v);
      const n = Number(v.toPrecision(15));
      return FLOAT_TYPES.has(type) && Number.isInteger(n) ? n.toFixed(1) : String(n);
    }
    if (typeof v === 'string') return top ? v : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map((x) => format(x, null, false)).join(', ') + ']';
    if (typeof v === 'function') return '[función]';
    if (v && typeof v === 'object') {
      return '{ ' + Object.keys(v).map((k) => `${k}: ${format(v[k], null, false)}`).join(', ') + ' }';
    }
    return String(v);
  }

  function run(ast, types, source) {
    const outputs = [];
    const lines = source.split('\n');
    let steps = 0;
    const tick = (node) => { if (++steps > MAX_STEPS) throw new RuntimeError('El programa tardó demasiado en ejecutarse (¿ciclo infinito?).', node); };
    const typeOf = (n) => (types && types.get(n)) || null;
    // Texto original de un nodo, tomado del código fuente (se muestra junto al resultado)
    const textOf = (n) => {
      const l = n.loc;
      if (!l) return '';
      if (l.line === l.endLine) return (lines[l.line - 1] || '').slice(l.column - 1, l.endColumn - 1);
      return (lines[l.line - 1] || '').slice(l.column - 1) + ' …';
    };

    const global = new Env(null);
    const builtins = {
      Math, parseInt, parseFloat, String, Boolean, isNaN, isFinite, Number, JSON,
      console: { log: (...a) => outputs.push({ kind: 'print', line: 0, text: a.map((x) => format(x, null, true)).join(' '), value: a[0] }) },
    };
    Object.keys(builtins).forEach((k) => global.vars.set(k, builtins[k]));

    // ---------- Expresiones ----------
    function lookup(node, env) {
      const e = env.find(node.name);
      if (!e) throw new RuntimeError(`'${node.name}' no está disponible al ejecutar el programa.`, node);
      return e;
    }
    function bin(op, l, r, node) {
      switch (op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': {
          if (r === 0 && typeof l === 'number') throw new RuntimeError('División entre cero.', node);
          const q = l / r;
          return INT_TYPES.has(typeOf(node)) ? Math.trunc(q) : q;
        }
        case '%':
          if (r === 0) throw new RuntimeError('División entre cero.', node);
          return l % r;
        case '**': return l ** r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '==': case '===': return l === r;
        case '!=': case '!==': return l !== r;
        case '&': return l & r;
        case '|': return l | r;
        case '^': return l ^ r;
        case '<<': return l << r;
        case '>>': return l >> r;
        case '>>>': return l >>> r;
        case '??': return l ?? r;
        case 'in': return l in r;
        default: throw new RuntimeError(`El operador '${op}' no se puede ejecutar.`, node);
      }
    }
    // &&, || y ?? evalúan el lado derecho solo si hace falta (por eso recibe una función)
    function logical(op, left, right) {
      if (op === '&&') return left ? right() : left;
      if (op === '||') return left ? left : right();
      return left ?? right();
    }
    function callFn(fn, args, node) {
      if (typeof fn !== 'function') throw new RuntimeError('Se intentó llamar algo que no es una función.', node);
      return fn(...args);
    }
    function makeFunction(node, env, name) {
      const f = (...args) => {
        const fenv = new Env(env);
        node.params.forEach((p, i) => {
          let v;
          if (p.rest) v = args.slice(i);
          else {
            v = args[i];
            if (v === undefined && p.defaultValue) v = ev(p.defaultValue, fenv);
          }
          fenv.vars.set(p.id.name, v);
        });
        if (node.type === 'ArrowFunctionExpression' && node.expression) return ev(node.body, fenv);
        try {
          execList(node.body.body, fenv);
        } catch (e) {
          if (e instanceof ReturnSig) return e.value;
          throw e;
        }
        return undefined;
      };
      Object.defineProperty(f, 'name', { value: name || 'flecha' });
      return f;
    }
    function assignTo(target, value, env, node) {
      if (target.type === 'Identifier') { lookup(target, env).vars.set(target.name, value); return; }
      if (target.type === 'MemberExpression') {
        const o = ev(target.object, env);
        const k = target.computed ? ev(target.property, env) : target.property.name;
        if (o === null || o === undefined) throw new RuntimeError('No se puede asignar a un valor nulo.', node);
        o[k] = value;
        return;
      }
      throw new RuntimeError('Destino de asignación no válido.', node);
    }
    // Evalúa los argumentos de una llamada, print, etc. (acepta ...spread)
    const evalArgs = (args, env) => args.map((a) => ev(a.type === 'SpreadElement' ? a.argument : a, env));

    function ev(node, env) {
      tick(node);
      switch (node.type) {
        case 'Literal': return node.value;
        case 'Identifier': return lookup(node, env).vars.get(node.name);
        case 'ThisExpression': throw new RuntimeError(NO_CLASES, node);
        case 'ArrayExpression': return node.elements.map((e) => (e ? ev(e.type === 'SpreadElement' ? e.argument : e, env) : undefined));
        case 'ObjectExpression': {
          const o = {};
          node.properties.forEach((p) => {
            if (p.type === 'Property') o[p.key.name !== undefined ? p.key.name : p.key.value] = ev(p.value, env);
          });
          return o;
        }
        case 'SequenceExpression': { let v; node.expressions.forEach((e) => { v = ev(e, env); }); return v; }
        case 'ConditionalExpression': return ev(node.test, env) ? ev(node.consequent, env) : ev(node.alternate, env);
        case 'LogicalExpression': return logical(node.operator, ev(node.left, env), () => ev(node.right, env));
        case 'BinaryExpression': return bin(node.operator, ev(node.left, env), ev(node.right, env), node);
        case 'UnaryExpression': {
          const v = ev(node.argument, env);
          switch (node.operator) {
            case '-': return -v;
            case '+': return +v;
            case '!': return !v;
            case '~': return ~v;
            case 'typeof': return typeof v;
            default: throw new RuntimeError(`El operador '${node.operator}' no se puede ejecutar.`, node);
          }
        }
        case 'UpdateExpression': {
          const old = ev(node.argument, env);
          const nuevo = node.operator === '++' ? old + 1 : old - 1;
          assignTo(node.argument, nuevo, env, node);
          return node.prefix ? nuevo : old;
        }
        case 'AssignmentExpression': {
          const op = node.operator;
          let v;
          if (op === '=') v = ev(node.right, env);
          else if (op === '&&=' || op === '||=' || op === '??=') v = logical(op.slice(0, -1), ev(node.left, env), () => ev(node.right, env));
          else v = bin(op.slice(0, -1), ev(node.left, env), ev(node.right, env), node);
          assignTo(node.left, v, env, node);
          return v;
        }
        case 'MemberExpression': {
          const o = ev(node.object, env);
          if (o === null || o === undefined) {
            if (node.optional) return undefined;
            throw new RuntimeError('No se puede leer una propiedad de un valor nulo.', node);
          }
          const k = node.computed ? ev(node.property, env) : node.property.name;
          const v = o[k];
          return typeof v === 'function' ? v.bind(o) : v;
        }
        case 'CallExpression': {
          const c = node.callee;
          const args = evalArgs(node.arguments, env);
          if (c.type === 'Identifier' && c.name === 'evaluar' && !env.find('evaluar')) {
            node.arguments.forEach((a, i) => {
              outputs.push({ kind: 'evaluar', line: node.loc.line, text: textOf(a), value: format(args[i], typeOf(a), true) });
            });
            return undefined;
          }
          const f = ev(c, env);
          return callFn(f, args, node);
        }
        case 'ArrowFunctionExpression': return makeFunction(node, env, null);
        case 'NewExpression': throw new RuntimeError(NO_CLASES, node);
        default: throw new RuntimeError('Esta expresión no se puede ejecutar.', node);
      }
    }

    // ---------- Instrucciones ----------
    function hoistFns(list, env) {
      list.forEach((s) => {
        const d = s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' ? s.declaration : s;
        if (d && d.type === 'FunctionDeclaration' && d.id) env.vars.set(d.id.name, makeFunction(d, env, d.id.name));
      });
    }
    function execList(list, env) {
      hoistFns(list, env);
      list.forEach((s) => exec(s, env));
    }
    function loopBody(body, env) {
      try { exec(body, env); } catch (e) {
        if (e instanceof ContinueSig) return true;
        if (e instanceof BreakSig) return false;
        throw e;
      }
      return true;
    }
    function exec(s, env) {
      tick(s);
      switch (s.type) {
        case 'EmptyStatement': return;
        case 'VariableDeclaration':
          s.declarations.forEach((d) => {
            const dt = s.dataType ? s.dataType : null;
            const v = d.init ? ev(d.init, env) : defaultFor(dt);
            env.vars.set(d.id.name, v);
          });
          return;
        case 'FunctionDeclaration': return;
        case 'ClassDeclaration': throw new RuntimeError(NO_CLASES, s);
        case 'ExpressionStatement': ev(s.expression, env); return;
        case 'BlockStatement': execList(s.body, new Env(env)); return;
        case 'IfStatement':
          if (ev(s.test, env)) exec(s.consequent, new Env(env));
          else if (s.alternate) exec(s.alternate, new Env(env));
          return;
        case 'WhileStatement':
          while (ev(s.test, env)) { tick(s); if (!loopBody(s.body, new Env(env))) break; }
          return;
        case 'DoWhileStatement':
          do { tick(s); if (!loopBody(s.body, new Env(env))) break; } while (ev(s.test, env));
          return;
        case 'ForStatement': {
          const fenv = new Env(env);
          if (s.init) { if (s.init.type === 'VariableDeclaration') exec(s.init, fenv); else ev(s.init, fenv); }
          while (!s.test || ev(s.test, fenv)) {
            tick(s);
            if (!loopBody(s.body, new Env(fenv))) break;
            if (s.update) ev(s.update, fenv);
          }
          return;
        }
        case 'ForOfStatement': case 'ForInStatement': {
          const coll = ev(s.right, env);
          const items = s.type === 'ForOfStatement' ? Array.from(coll) : Object.keys(coll || {});
          for (const it of items) {
            tick(s);
            const fenv = new Env(env);
            if (s.left.type === 'VariableDeclaration') fenv.vars.set(s.left.declarations[0].id.name, it);
            else assignTo(s.left, it, env, s);
            if (!loopBody(s.body, fenv)) break;
          }
          return;
        }
        case 'SwitchStatement': {
          const d = ev(s.discriminant, env);
          const senv = new Env(env);
          let start = s.cases.findIndex((c) => c.test && ev(c.test, senv) === d);
          if (start < 0) start = s.cases.findIndex((c) => !c.test);
          if (start < 0) return;
          try {
            for (let i = start; i < s.cases.length; i++) execList(s.cases[i].consequent, senv);
          } catch (e) { if (!(e instanceof BreakSig)) throw e; }
          return;
        }
        case 'ReturnStatement': throw new ReturnSig(s.argument ? ev(s.argument, env) : undefined);
        case 'BreakStatement': throw new BreakSig();
        case 'ContinueStatement': throw new ContinueSig();
        case 'PrintStatement': {
          const vals = evalArgs(s.arguments, env).map((v, i) => format(v, typeOf(s.arguments[i]), true));
          outputs.push({ kind: 'print', line: s.loc.line, text: vals.join(' '), value: vals.join(' ') });
          return;
        }
        case 'ThrowStatement': throw new ThrowSig(ev(s.argument, env), s);
        case 'TryStatement': {
          try {
            try { exec(s.block, env); } catch (e) {
              if (!(e instanceof ThrowSig) || !s.handler) throw e;
              const cenv = new Env(env);
              if (s.handler.param) cenv.vars.set(s.handler.param.name, e.value);
              execList(s.handler.body.body, cenv);
            }
          } finally {
            if (s.finalizer) exec(s.finalizer, env);
          }
          return;
        }
        case 'ImportDeclaration':
          s.specifiers.forEach((sp) => { if (sp.local) env.vars.set(sp.local.name, undefined); });
          return;
        case 'ExportNamedDeclaration': if (s.declaration) exec(s.declaration, env); return;
        case 'ExportDefaultDeclaration': {
          const d = s.declaration;
          if (!d || d.type === 'FunctionDeclaration') return; // las funciones ya se declararon al entrar al bloque
          if (d.type === 'ClassDeclaration') exec(d, env); else ev(d, env);
          return;
        }
        case 'ExportAllDeclaration': return;
        default: throw new RuntimeError('Esta instrucción no se puede ejecutar.', s);
      }
    }

    // Convierte lo que se lanzó durante la ejecución en un error entendible (o ninguno)
    let error = null;
    try {
      execList(ast.body, global);
    } catch (e) {
      if (e instanceof RuntimeError) error = { message: e.message, ...posOf(e.node) };
      else if (e instanceof ThrowSig) error = { message: `Excepción no capturada: ${format(e.value, null, true)}`, ...posOf(e.node) };
      else if (e instanceof RangeError) error = { message: 'Desbordamiento de pila: demasiadas llamadas anidadas (¿recursión sin fin?).', line: 1, column: 1 };
      else if (!(e instanceof ReturnSig || e instanceof BreakSig || e instanceof ContinueSig)) {
        error = { message: 'Error al ejecutar: ' + (e && e.message ? e.message : e), line: 1, column: 1 };
      }
    }
    return { outputs, error };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { run };
  else window.runProgram = run;
})();
