'use strict';
/* =====================================================================
 *  ANÁLISIS SEMÁNTICO  (etapa 3)
 *  Entrada : el AST que produce parser.js (sin errores sintácticos)
 *  Salida  : { errors, warnings, symbols, types }
 *
 *  Qué comprueba:
 *   1. Variables: declaradas antes de usarse, sin duplicados en el mismo ámbito,
 *      constantes sin reasignar, 'const' con valor inicial.
 *   2. Tipos: asignaciones, operadores, condiciones, índices, retornos.
 *   3. Funciones: número y tipo de argumentos, valor de retorno, 'return' en todos los caminos.
 *   4. Control de flujo: 'return' / 'break' / 'continue' / 'this' bien ubicados.
 *   5. Clases, 'switch', módulos y varias advertencias (variable sin usar, código inalcanzable...).
 * ===================================================================== */
(function () {
  // ---------- Tipos numéricos ----------
  const RANK = new Map([['char', 0], ['short', 1], ['int', 2], ['long', 3], ['float', 4], ['double', 5]]);
  const RANK_NAME = { 2: 'int', 3: 'long', 4: 'float', 5: 'double' };
  const isArith = (t) => RANK.has(t) && t !== 'char'; // char no se mezcla con números
  const isArr = (t) => typeof t === 'string' && t.endsWith('[]');
  const elemOf = (t) => t.slice(0, -2);
  const isFnT = (t) => typeof t === 'string' && t.startsWith('(');
  const norm = (t) => (t ? t.replace(/^boolean/, 'bool') : t);
  // Tipo resultante de operar a y b: el más "ancho" de los dos, y nunca menor que int (short + short = int)
  const promote = (a, b = 'int') => RANK_NAME[Math.max(RANK.get(a), RANK.get(b), 2)];

  // ---------- Miembros predefinidos (métodos de string, arreglos, números...) ----------
  // Un parámetro se escribe como 'int' (obligatorio), 'int?' (opcional) o '...int' (cantidad variable).
  const P = (s) => (s.endsWith('?') ? { type: s.slice(0, -1), optional: true } : s.startsWith('...') ? { type: s.slice(3), rest: true } : { type: s });
  const F = (ps, ret) => ({ params: ps.map(P), ret });
  const STR = {
    length: 'int', toUpperCase: F([], 'string'), toLowerCase: F([], 'string'), trim: F([], 'string'),
    trimStart: F([], 'string'), trimEnd: F([], 'string'), charAt: F(['int'], 'string'), at: F(['int'], 'string'),
    charCodeAt: F(['int?'], 'int'), codePointAt: F(['int?'], 'int'), indexOf: F(['string', 'int?'], 'int'),
    lastIndexOf: F(['string', 'int?'], 'int'), includes: F(['string', 'int?'], 'bool'), startsWith: F(['string', 'int?'], 'bool'),
    endsWith: F(['string', 'int?'], 'bool'), substring: F(['int', 'int?'], 'string'), substr: F(['int', 'int?'], 'string'),
    slice: F(['int?', 'int?'], 'string'), split: F(['string?', 'int?'], 'string[]'), replace: F(['any', 'any'], 'string'),
    replaceAll: F(['any', 'any'], 'string'), repeat: F(['int'], 'string'), concat: F(['...any'], 'string'),
    padStart: F(['int', 'string?'], 'string'), padEnd: F(['int', 'string?'], 'string'), toString: F([], 'string'),
    localeCompare: F(['string'], 'int'), match: F(['any'], 'any'), search: F(['any'], 'int'), normalize: F(['string?'], 'string'),
  };
  const NUM = { toFixed: F(['int?'], 'string'), toString: F(['int?'], 'string'), toPrecision: F(['int?'], 'string'), valueOf: F([], 'any') };
  const BOOL = { toString: F([], 'string'), valueOf: F([], 'bool') };
  const arrMembers = (T) => ({
    length: 'int', push: F(['...' + T], 'int'), unshift: F(['...' + T], 'int'), pop: F([], T), shift: F([], T),
    join: F(['string?'], 'string'), indexOf: F([T, 'int?'], 'int'), lastIndexOf: F([T, 'int?'], 'int'), includes: F([T, 'int?'], 'bool'),
    slice: F(['int?', 'int?'], T + '[]'), splice: F(['int', 'int?', '...' + T], T + '[]'), reverse: F([], T + '[]'),
    sort: F(['any?'], T + '[]'), concat: F(['...any'], T + '[]'), fill: F([T, 'int?', 'int?'], T + '[]'),
    map: F(['any'], 'any[]'), filter: F(['any'], T + '[]'), forEach: F(['any'], 'void'), find: F(['any'], T),
    findIndex: F(['any'], 'int'), some: F(['any'], 'bool'), every: F(['any'], 'bool'), reduce: F(['any', 'any?'], 'any'),
    flat: F(['any?'], 'any[]'), at: F(['int'], T), toString: F([], 'string'), keys: F([], 'any'), entries: F([], 'any'),
  });

  // Nombres globales que existen siempre; se tratan como 'any' porque no se modelan sus tipos
  const BUILTIN_VALUES = ['console', 'Math', 'JSON', 'Object', 'Array', 'Number', 'Date', 'Error', 'Map', 'Set', 'Promise', 'RegExp',
    'Symbol', 'window', 'document', 'globalThis', 'module', 'require', 'process', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'alert', 'prompt', 'confirm', 'super', 'TypeError', 'RangeError'];
  // Funciones globales con tipo de retorno conocido (aceptan cualquier argumento)
  const BUILTIN_FUNCS = { evaluar: 'void', parseInt: 'int', parseFloat: 'float', String: 'string', Boolean: 'bool', isNaN: 'bool', isFinite: 'bool' };

  // Tamaño simulado en memoria de cada tipo (para la columna "dirección" de la tabla de símbolos)
  const SIZES = { char: 1, bool: 1, short: 2, int: 4, float: 4, long: 8, double: 8 };
  const sizeOf = (t) => SIZES[t] || 8; // string, arreglos, objetos y funciones guardan una referencia (8)

  // Ancho en columnas de lo que ocupa un nodo (para subrayar el error en la interfaz)
  const lengthOf = (loc) => (loc && loc.endLine === loc.line ? Math.max(1, loc.endColumn - loc.column) : 1);

  // ---------- Recorridos genéricos del AST ----------
  function eachChild(node, cb) {
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x === 'object' && x.type) cb(x); });
      else if (v && typeof v === 'object' && v.type) cb(v);
    }
  }
  // Funciones y clases tienen su propio cuerpo: los recorridos "planos" no entran en ellas
  const FN_NODES = new Set(['FunctionDeclaration', 'ArrowFunctionExpression', 'MethodDefinition', 'ClassDeclaration']);
  function walk(node, cb) {
    if (cb(node) === false) return;
    eachChild(node, (c) => { if (!FN_NODES.has(c.type)) walk(c, cb); });
  }
  function hasValueReturn(body) {
    let found = false;
    walk(body, (n) => { if (n.type === 'ReturnStatement' && n.argument) found = true; return !found; });
    return found;
  }
  // Tipo de retorno cuando no se escribió: 'any' si algún return devuelve valor, si no 'void'
  const inferReturn = (body) => (hasValueReturn(body) ? 'any' : 'void');
  function containsBreak(list) {
    let found = false;
    const go = (n) => {
      if (found) return;
      if (n.type === 'BreakStatement') { found = true; return; }
      // un break dentro de otro ciclo/switch o función no corta el ciclo que estamos mirando
      if (FN_NODES.has(n.type) || /^(While|DoWhile|For|ForIn|ForOf|Switch)Statement$/.test(n.type)) return;
      eachChild(n, go);
    };
    list.forEach(go);
    return found;
  }
  const isTrueLit = (n) => !n || (n.type === 'Literal' && n.value === true);

  // Recorre la cadena de herencia (clase, su padre, su abuelo...) con tope por si hay ciclos
  function* herencia(info) {
    for (let i = 0; info && i < 50; i++, info = info.superInfo) yield info;
  }

  // =====================================================================
  //  analyze(ast): una sola pasada con ámbitos + una cola para los cuerpos de funciones
  // =====================================================================
  function analyze(ast) {
    const errors = [];
    const warnings = [];
    const seen = new Set();
    const types = new WeakMap();
    const sigs = new Map();
    const classes = new Map();
    const allSymbols = [];
    const queue = [];
    const fnSyms = new WeakMap();
    const clsInfos = new WeakMap();

    // ---------- Mensajes (sin repetir el mismo mensaje en la misma posición) ----------
    function add(sev, node, message) {
      const l = node && node.loc;
      if (!l) return;
      const key = sev + '|' + l.line + '|' + l.column + '|' + message;
      if (seen.has(key)) return;
      seen.add(key);
      (sev === 'error' ? errors : warnings).push({ message, severity: sev, line: l.line, column: l.column, length: lengthOf(l) });
    }
    const err = (n, m) => add('error', n, m);
    const warn = (n, m) => add('warning', n, m);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    // ---------- Ámbitos ----------
    // 'symbols' = lo ya declarado; 'later' = let/const que se declararán más abajo (para avisar "usada antes de declararse")
    class Scope {
      constructor(kind, parent, label) { this.kind = kind; this.parent = parent; this.label = label; this.symbols = new Map(); this.later = new Map(); }
    }
    const fnScope = (s) => { while (s.kind === 'block') s = s.parent; return s; };
    const KIND_ART = { variable: 'una variable', constante: 'una constante', 'parámetro': 'un parámetro', 'función': 'una función', clase: 'una clase', 'importación': 'una importación' };
    const llamada = (k) => (k === 'parámetro' ? 'llamado' : 'llamada');

    // Registra un símbolo en el ámbito. Si el nombre ya existe se informa el error y el símbolo queda 'detached'
    // (no entra en la tabla). 'var' repetido es válido en JavaScript, por eso se permite entre varStyle.
    function declare(scope, name, kind, type, idNode, extra) {
      const prev = scope.symbols.get(name);
      const sym = Object.assign({
        name, kind, type, scope: scope.label, line: idNode.loc ? idNode.loc.line : 0, column: idNode.loc ? idNode.loc.column : 0,
        length: lengthOf(idNode.loc), used: false, idNode, refs: new Set(),
      }, extra || {});
      if (prev) {
        if (!(sym.varStyle && prev.varStyle)) {
          err(idNode, `Ya existe ${KIND_ART[prev.kind] || 'un símbolo'} ${llamada(prev.kind)} '${name}' en este ámbito (línea ${prev.line}).`);
        }
        return sym.varStyle && prev.varStyle ? prev : Object.assign(sym, { detached: true });
      }
      if (kind === 'variable' || kind === 'constante' || kind === 'parámetro') {
        const root = fnScope(scope);
        sym.address = root.next || 0;
        root.next = sym.address + sizeOf(type);
      }
      scope.symbols.set(name, sym);
      allSymbols.push(sym);
      return sym;
    }

    // Busca un nombre desde el ámbito actual hacia afuera; si no está, distingue "declarado más abajo" de "no existe"
    function resolve(name, node, scope) {
      for (let s = scope; s; s = s.parent) {
        const sym = s.symbols.get(name);
        if (sym) return sym;
      }
      for (let s = scope; s; s = s.parent) {
        if (s.later.has(name)) {
          err(node, `La variable '${name}' se usa antes de declararse (se declara en la línea ${s.later.get(name)}).`);
          return null;
        }
      }
      err(node, `No se encontró ninguna variable, función o clase llamada '${name}'. ¿La declaraste antes de usarla?`);
      return null;
    }

    // ---------- Firmas de funciones ----------
    // El tipo de una función es un texto único como '(int, int) => int'; 'sigs' guarda sus detalles.
    function mkSig(params, ret) {
      const key = '(' + params.map((p) => (p.rest ? '...' : '') + p.type + (p.optional ? '?' : '')).join(', ') + ') => ' + ret;
      if (!sigs.has(key)) sigs.set(key, { params, ret });
      return key;
    }
    const paramList = (params) => params.map((p) => ({
      name: p.id.name, type: norm(p.dataType) || 'any', optional: !!p.defaultValue, rest: !!p.rest,
    }));

    // ¿La instrucción siempre termina el flujo?  mode 'returns': solo return/throw;  'exits': también break/continue
    function term(s, mode) {
      if (!s) return false;
      switch (s.type) {
        case 'ReturnStatement': case 'ThrowStatement': return true;
        case 'BreakStatement': case 'ContinueStatement': return mode === 'exits';
        case 'BlockStatement': return s.body.some((x) => x.type !== 'FunctionDeclaration' && term(x, mode));
        case 'IfStatement': return !!s.alternate && term(s.consequent, mode) && term(s.alternate, mode);
        case 'WhileStatement': return isTrueLit(s.test) && s.test && !containsBreak([s.body]);
        case 'DoWhileStatement': return (isTrueLit(s.test) && !containsBreak([s.body])) || term(s.body, mode);
        case 'ForStatement': return !s.test && !containsBreak([s.body]);
        case 'SwitchStatement': {
          if (!s.cases.some((c) => !c.test)) return false;
          if (containsBreak(s.cases.flatMap((c) => c.consequent))) return false;
          const last = s.cases[s.cases.length - 1];
          return last.consequent.some((x) => term(x, mode));
        }
        case 'TryStatement':
          return (term(s.block, mode) && (!s.handler || term(s.handler.body, mode))) || (!!s.finalizer && term(s.finalizer, mode));
        default: return false;
      }
    }

    // ---------- Reglas de tipos ----------
    // ¿Es un tipo "por referencia" (admite null)?
    const isRefT = (t) => t === 'string' || isArr(t) || t === 'object' || t === 'null' || t === 'any' || isFnT(t) || classes.has(t);
    function isSub(a, b) {
      for (const info of herencia(classes.get(a))) if (info.name === b) return true;
      return false;
    }
    const isIntLit = (n) => n && ((n.type === 'Literal' && n.dataType === 'int') ||
      (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && n.argument.dataType === 'int'));

    // ¿Cabe un valor de tipo 'from' en algo de tipo 'to'? 'node' permite aceptar literales (short = 5, char = 'a')
    function canAssign(to, from, node) {
      if (to === from || to === 'any' || from === 'any') return true;
      if (to === 'void' || from === 'void') return false;
      if (isArith(to) && isArith(from)) {
        if (to === 'char') return false;
        if (to === 'short' && from === 'int' && isIntLit(node)) return true;
        return RANK.get(from) <= RANK.get(to);
      }
      if (to === 'char') return from === 'string' && !!node && node.type === 'Literal' && node.dataType === 'string' && [...String(node.value)].length === 1;
      if (to === 'string' && from === 'char') return true;
      if (from === 'null') return isRefT(to);
      if (from === 'undefined') return to === 'undefined';
      if (isArr(to) && isArr(from)) return canAssign(elemOf(to), elemOf(from));
      if (to === 'object') return from === 'object' || classes.has(from) || isArr(from);
      if (classes.has(to) && classes.has(from)) return isSub(from, to);
      if (isFnT(to) && isFnT(from)) return true;
      return false;
    }
    // Tipo común de dos ramas (a ? x : y, [x, y], x ?? y); si no hay uno claro, 'any'
    function unify(a, b) {
      if (a === b) return a;
      if (a === 'any' || b === 'any') return 'any';
      if (isArith(a) && isArith(b)) return promote(a, b);
      if (a === 'null' && isRefT(b)) return b;
      if (b === 'null' && isRefT(a)) return a;
      if ((a === 'char' && b === 'string') || (a === 'string' && b === 'char')) return 'string';
      return 'any';
    }
    function comparable(l, r) {
      if (l === 'any' || r === 'any' || l === r) return true;
      if (isArith(l) && isArith(r)) return true;
      if ((l === 'null' || l === 'undefined') && (isRefT(r) || r === 'undefined' || r === 'null')) return true;
      if ((r === 'null' || r === 'undefined') && (isRefT(l) || l === 'undefined' || l === 'null')) return true;
      if ((l === 'char' && r === 'string') || (l === 'string' && r === 'char')) return true;
      return canAssign(l, r) || canAssign(r, l);
    }
    // Una variable sin tipo explícito no puede quedarse con tipo 'null' o 'undefined': pasa a 'any'
    const widen = (t) => (t === 'null' || t === 'undefined' ? 'any' : t);
    const isIntegerT = (t) => t === 'int' || t === 'short' || t === 'long';

    // Tipo del resultado de 'l op r' y errores de operandos. 'disp' es el operador a mostrar (+= en vez de +).
    function binaryType(op, l, r, node, rightNode, disp) {
      disp = disp || op;
      if ((op === '/' || op === '%') && isArith(r) && rightNode && rightNode.type === 'Literal' && rightNode.value === 0 && isArith(l)) {
        err(rightNode, 'División entre cero.');
      }
      const bad = () => { err(node, `El operador '${disp}' no se puede aplicar a operandos de tipo ${l} y ${r}.`); return 'any'; };
      switch (op) {
        case '+':
          if (l === 'string' || r === 'string') return (l === 'any' && r === 'any') ? 'any' : 'string';
          if (l === 'any' || r === 'any') return 'any';
          if (isArith(l) && isArith(r)) return promote(l, r);
          return bad();
        case '-': case '*': case '/': case '%': case '**':
          if (l === 'any' || r === 'any') return (isArith(l) && l !== 'char') ? l : (isArith(r) && r !== 'char') ? r : 'any';
          if (isArith(l) && isArith(r)) return promote(l, r);
          return bad();
        case '<': case '>': case '<=': case '>=':
          if (l === 'any' || r === 'any' || (isArith(l) && isArith(r)) || ((l === 'string' || l === 'char') && (r === 'string' || r === 'char'))) return 'bool';
          bad(); return 'bool';
        case '==': case '!=': case '===': case '!==':
          if (!comparable(l, r)) err(node, `No se pueden comparar valores de tipo ${l} y ${r} con '${disp}': son tipos incompatibles.`);
          return 'bool';
        case '&&': case '||':
          if ((l !== 'bool' && l !== 'any') || (r !== 'bool' && r !== 'any')) {
            err(node, `El operador '${disp}' necesita operandos de tipo bool, pero se encontró ${l} y ${r}.`);
          }
          return 'bool';
        case '&': case '|': case '^':
          if (l === 'bool' && r === 'bool') return 'bool';
        // eslint-disable-next-line no-fallthrough
        case '<<': case '>>': case '>>>':
          if (l === 'any' || r === 'any') return 'any';
          if (isIntegerT(l) && isIntegerT(r)) return promote(l, r);
          err(node, `El operador '${disp}' solo se puede aplicar a enteros, pero se encontró ${l} y ${r}.`);
          return 'any';
        case '??': return unify(l, r);
        case 'in': case 'instanceof': return 'bool';
        default: return 'any';
      }
    }

    // ---------- Clases ----------
    function findMember(info, name) {
      for (const c of herencia(info)) {
        if (c.fields.has(name)) return { kind: 'field', type: c.fields.get(name).type, info: c };
        if (c.methods.has(name)) return { kind: 'method', type: c.methods.get(name).sig, info: c };
      }
      return null;
    }
    // Si alguna clase de la cadena hereda de algo desconocido no se puede afirmar que un miembro "no existe"
    const hasUnknownBase = (info) => { for (const c of herencia(info)) if (c.unknownBase) return true; return false; };
    // El constructor se hereda: se usa el de la clase o el del ancestro más cercano
    function findCtor(info) {
      for (const c of herencia(info)) if (c.ctor) return c.ctor;
      return null;
    }
    function literalType(n) {
      return n && n.type === 'Literal' && n.dataType !== 'null' && n.dataType !== 'undefined' ? n.dataType : 'any';
    }
    // Primera pasada sobre una clase: junta sus campos, métodos y constructor (sin revisar los cuerpos todavía)
    function buildClass(node) {
      const info = {
        name: node.id.name, superName: node.superClass ? node.superClass.name : null, superInfo: null, unknownBase: false,
        fields: new Map(), methods: new Map(), ctor: null, node,
      };
      for (const m of node.body) {
        const nm = m.id.name;
        if (m.type === 'FieldDefinition') {
          if (info.fields.has(nm) || info.methods.has(nm)) { err(m.id, `La clase '${info.name}' ya tiene un miembro llamado '${nm}'.`); continue; }
          const type = m.dataType ? norm(m.dataType) : widen(literalType(m.init));
          info.fields.set(nm, { type, isConst: m.kind === 'const', node: m });
        } else if (m.kind === 'constructor' || nm === info.name) {
          m.kind = 'constructor';
          if (info.ctor) { err(m.id, `La clase '${info.name}' solo puede tener un constructor.`); continue; }
          info.ctor = { sig: mkSig(paramList(m.params), 'void'), node: m };
        } else {
          if (info.fields.has(nm) || info.methods.has(nm)) { err(m.id, `La clase '${info.name}' ya tiene un miembro llamado '${nm}'.`); continue; }
          const ret = m.returnType ? norm(m.returnType) : inferReturn(m.body);
          info.methods.set(nm, { sig: mkSig(paramList(m.params), ret), node: m, ret });
        }
      }
      // campos implícitos: this.x = ... dentro de un método también declara el campo x
      for (const m of node.body) {
        if (m.type !== 'MethodDefinition') continue;
        walk(m.body, (n) => {
          if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed &&
              n.left.object.type === 'ThisExpression' && !info.fields.has(n.left.property.name) && !info.methods.has(n.left.property.name)) {
            info.fields.set(n.left.property.name, { type: 'any', implicit: true, node: n.left });
          }
        });
      }
      return info;
    }

    // =====================================================================
    //  Hoisting: funciones y clases se conocen antes de ejecutarse el código
    // =====================================================================
    function unwrap(s) {
      if (s.type === 'ExportNamedDeclaration' && s.declaration) return s.declaration;
      if (s.type === 'ExportDefaultDeclaration' && s.declaration && (s.declaration.type === 'FunctionDeclaration' || s.declaration.type === 'ClassDeclaration')) return s.declaration;
      return s;
    }
    function hoist(list, ctx) {
      const scope = ctx.scope;
      const classNodes = [];
      for (const raw of list) {
        const s = unwrap(raw);
        if (s.type === 'FunctionDeclaration' && s.id) {
          const ret = s.returnType ? norm(s.returnType) : inferReturn(s.body);
          const key = mkSig(paramList(s.params), ret);
          fnSyms.set(s, declare(scope, s.id.name, 'función', key, s.id, { ret }));
        } else if (s.type === 'ClassDeclaration' && s.id) {
          const info = buildClass(s);
          classes.set(info.name, info);
          clsInfos.set(s, info);
          declare(scope, info.name, 'clase', 'clase ' + info.name, s.id, { cls: info });
          classNodes.push(s);
        } else if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
          for (const d of s.declarations) if (d.id && !scope.later.has(d.id.name)) scope.later.set(d.id.name, d.id.loc.line);
        }
      }
      for (const s of classNodes) {
        const info = clsInfos.get(s);
        if (!s.superClass) continue;
        const bn = s.superClass.name;
        if (bn === info.name) { err(s.superClass, `La clase '${bn}' no puede extenderse a sí misma.`); info.unknownBase = true; continue; }
        let sym = null;
        for (let sc = scope; sc && !sym; sc = sc.parent) sym = sc.symbols.get(bn) || null;
        if (sym && sym.cls) {
          info.superInfo = sym.cls;
          for (const p of herencia(sym.cls)) {
            if (p === info) { err(s.superClass, `Herencia circular: la clase '${info.name}' termina heredando de sí misma.`); info.superInfo = null; info.unknownBase = true; break; }
          }
        } else info.unknownBase = true;
      }
    }

    // =====================================================================
    //  Expresiones
    // =====================================================================
    // Igual que expr(), pero exige que la expresión produzca un valor (una función void no sirve)
    function val(node, ctx, expected) {
      const t = expr(node, ctx, expected);
      if (t === 'void') {
        const nm = node.type === 'CallExpression' && node.callee.type === 'Identifier' ? `La función '${node.callee.name}'` : 'Esta expresión';
        err(node, `${nm} no devuelve ningún valor (es void), no se puede usar como valor.`);
        return 'any';
      }
      return t;
    }
    // Tipa una expresión y guarda el resultado en 'types' (el intérprete lo usa, p. ej. para int / int)
    function expr(node, ctx, expected) {
      const t = exprInner(node, ctx, expected);
      types.set(node, t);
      return t;
    }
    // Recorre los argumentos solo para tipar sus expresiones (cuando no hay firma contra la que compararlos)
    function visitArgs(args, ctx) {
      args.forEach((a) => expr(a.type === 'SpreadElement' ? a.argument : a, ctx));
    }
    // Compara los argumentos de una llamada con la firma: cantidad y tipo de cada uno
    function checkCall(sig, name, args, node, ctx) {
      const ps = sig.params;
      const rest = ps.some((p) => p.rest);
      const need = ps.filter((p) => !p.optional && !p.rest).length;
      const max = rest ? Infinity : ps.length;
      const n = args.length;
      if (n < need || n > max) {
        let want;
        if (rest) want = `al menos ${plural(need, 'argumento')}`;
        else if (need === max) want = plural(need, 'argumento');
        else want = `entre ${need} y ${plural(max, 'argumento')}`;
        const subj = name.startsWith('constructor de ') ? `El constructor de la clase '${name.slice(15)}'` : `La función '${name}'`;
        err(n > max ? args[max] : node, `${subj} espera ${want}, pero se pasó ${n}.`);
      }
      args.forEach((a, i) => {
        const p = i < ps.length ? ps[i] : (rest ? ps[ps.length - 1] : null);
        const pt = p ? p.type : null;
        const at = a.type === 'SpreadElement' ? (expr(a.argument, ctx), 'any') : val(a, ctx, pt || undefined);
        if (pt && a.type !== 'SpreadElement' && !canAssign(pt, at, a)) {
          err(a, `El argumento ${i + 1} de '${name}' debe ser de tipo ${pt}, pero es de tipo ${at}.`);
        }
      });
      return sig.ret;
    }
    function memberType(node, ctx) {
      const ot = val(node.object, ctx);
      if (node.computed) {
        const it = val(node.property, ctx);
        if (isArr(ot) || ot === 'string') {
          if (it !== 'any' && !isIntegerT(it) || it === 'char') {
            err(node.property, `El índice de un ${ot === 'string' ? 'texto' : 'arreglo'} debe ser un entero, pero es de tipo ${it}.`);
          }
          return ot === 'string' ? 'string' : elemOf(ot);
        }
        return 'any';
      }
      const name = node.property.name;
      let table = null;
      if (ot === 'string') table = STR;
      else if (isArr(ot)) table = arrMembers(elemOf(ot));
      else if (isArith(ot)) table = NUM;
      else if (ot === 'bool') table = BOOL;
      else if (classes.has(ot)) {
        const info = classes.get(ot);
        const m = findMember(info, name);
        if (m) return m.type;
        if (!hasUnknownBase(info)) err(node.property, `La clase '${ot}' no tiene ningún campo ni método llamado '${name}'.`);
        return 'any';
      } else if (ot === 'null' || ot === 'undefined') {
        err(node.property, `No se puede acceder a '${name}' porque el valor es ${ot}.`);
        return 'any';
      } else return 'any';
      if (Object.prototype.hasOwnProperty.call(table, name)) {
        const m = table[name];
        return typeof m === 'string' ? m : mkSig(m.params, m.ret);
      }
      err(node.property, `El tipo ${ot} no tiene ningún miembro llamado '${name}'.`);
      return 'any';
    }
    function useIdent(node, ctx) {
      const s = resolve(node.name, node, ctx.scope);
      if (!s) return null;
      s.used = true;
      if (node.loc) s.refs.add(node.loc.line);
      return s;
    }
    function arrowFn(node, ctx) {
      const scope = new Scope('function', ctx.scope, 'función flecha (línea ' + node.loc.line + ')');
      const fctx = { scope, fn: { name: 'la función flecha', ret: 'any', arrow: true }, loop: false, sw: false, cls: ctx.cls };
      const ps = declareParams(node.params, fctx);
      let ret = 'any';
      if (node.body.type === 'BlockStatement') analyzeStatementList(node.body.body, fctx);
      else { ret = val(node.body, fctx); ret = ret === 'null' || ret === 'undefined' ? 'any' : ret; }
      return mkSig(ps, ret);
    }
    function declareParams(params, fctx) {
      const out = [];
      for (const p of params) {
        const base = norm(p.dataType) || 'any';
        if (p.defaultValue) {
          const dt = val(p.defaultValue, fctx, base);
          if (!canAssign(base, dt, p.defaultValue)) err(p.defaultValue, `El valor por defecto del parámetro '${p.id.name}' debe ser de tipo ${base}, pero es de tipo ${dt}.`);
        }
        declare(fctx.scope, p.id.name, 'parámetro', p.rest ? base + '[]' : base, p.id, { used: true });
        out.push({ name: p.id.name, type: base, optional: !!p.defaultValue, rest: !!p.rest });
      }
      return out;
    }

    // Calcula el tipo de una expresión. 'expected' es el tipo esperado por el contexto (sirve para tipar arreglos).
    function exprInner(node, ctx, expected) {
      switch (node.type) {
        case 'Literal': return node.dataType;
        case 'Identifier': {
          const s = useIdent(node, ctx);
          return s ? s.type : 'any';
        }
        case 'ThisExpression':
          if (!ctx.cls) { err(node, "'this' solo puede usarse dentro de una clase (en un método o constructor)."); return 'any'; }
          return ctx.cls.name;
        case 'ArrayExpression': {
          const exp = expected && isArr(expected) ? elemOf(expected) : null;
          const ts = node.elements.map((e) => {
            if (!e) return 'any';
            if (e.type === 'SpreadElement') { expr(e.argument, ctx); return 'any'; }
            return val(e, ctx, exp || undefined);
          });
          if (exp && exp !== 'any') {
            ts.forEach((t, i) => {
              const e = node.elements[i];
              if (e && e.type !== 'SpreadElement' && !canAssign(exp, t, e)) err(e, `El elemento ${i + 1} del arreglo debe ser de tipo ${exp}, pero es de tipo ${t}.`);
            });
            return expected;
          }
          if (!ts.length) return 'any[]';
          let u = ts[0];
          for (let i = 1; i < ts.length; i++) u = unify(u, ts[i]);
          return widen(u) + '[]';
        }
        case 'ObjectExpression':
          node.properties.forEach((p) => {
            if (p.type === 'Property') {
              if (p.shorthand) { const s = useIdent(p.value, ctx); types.set(p.value, s ? s.type : 'any'); } else val(p.value, ctx);
            } else if (p.argument) expr(p.argument, ctx);
          });
          return 'object';
        case 'SequenceExpression': {
          let t = 'any';
          node.expressions.forEach((e, i) => { t = i === node.expressions.length - 1 ? val(e, ctx) : expr(e, ctx); });
          return t;
        }
        case 'ConditionalExpression': {
          cond(node.test, ctx, 'operador ?:');
          return unify(val(node.consequent, ctx), val(node.alternate, ctx));
        }
        case 'LogicalExpression': case 'BinaryExpression': {
          const l = val(node.left, ctx);
          const r = val(node.right, ctx);
          return binaryType(node.operator, l, r, node, node.right);
        }
        case 'UnaryExpression': {
          const t = val(node.argument, ctx);
          const op = node.operator;
          if (op === 'typeof') return 'string';
          if (op === '!') {
            if (t !== 'bool' && t !== 'any') err(node, `El operador '!' necesita un valor de tipo bool, pero se encontró ${t}.`);
            return 'bool';
          }
          if (op === '-' || op === '+') {
            if (t === 'any') return 'any';
            if (!isArith(t)) { err(node, `El operador '${op}' unario necesita un número, pero se encontró ${t}.`); return 'any'; }
            return promote(t);
          }
          if (op === '~') {
            if (t !== 'any' && !isIntegerT(t)) err(node, `El operador '~' necesita un entero, pero se encontró ${t}.`);
            return t === 'any' ? 'any' : promote(t);
          }
          return 'any';
        }
        case 'UpdateExpression': {
          const a = node.argument;
          let t;
          if (a.type === 'Identifier') {
            const s = useIdent(a, ctx);
            t = s ? s.type : 'any';
            types.set(a, t);
            if (s && s.kind === 'constante') err(a, `No se puede modificar la constante '${a.name}' con '${node.operator}'.`);
          } else t = expr(a, ctx);
          if (t !== 'any' && !isArith(t)) err(node, `El operador '${node.operator}' solo se puede aplicar a números, pero el valor es de tipo ${t}.`);
          return t;
        }
        case 'AssignmentExpression': return assignment(node, ctx);
        case 'MemberExpression': return memberType(node, ctx);
        case 'CallExpression': {
          const c = node.callee;
          const args = node.arguments;
          let t;
          let name = 'la función';
          if (c.type === 'Identifier') {
            const s = useIdent(c, ctx);
            if (!s) { visitArgs(args, ctx); return 'any'; }
            name = c.name;
            types.set(c, s.type);
            if (s.kind === 'clase') {
              err(node, `Para crear un objeto de la clase '${c.name}' hay que usar 'new': new ${c.name}(...).`);
              visitArgs(args, ctx);
              return c.name;
            }
            t = s.type;
          } else if (c.type === 'MemberExpression') {
            t = memberType(c, ctx);
            types.set(c, t);
            name = c.computed ? 'la función' : c.property.name;
          } else t = val(c, ctx);
          if (t === 'any') { visitArgs(args, ctx); return 'any'; }
          const sig = sigs.get(t);
          if (!sig) {
            err(node, `'${name}' no es una función (es de tipo ${t}), no se puede llamar.`);
            visitArgs(args, ctx);
            return 'any';
          }
          return checkCall(sig, name, args, node, ctx);
        }
        case 'NewExpression': {
          const c = node.callee;
          const args = node.arguments;
          if (c.type === 'Identifier') {
            const s = useIdent(c, ctx);
            if (!s) { visitArgs(args, ctx); return 'any'; }
            types.set(c, s.type);
            if (s.cls) {
              const ctor = findCtor(s.cls);
              if (ctor) checkCall(sigs.get(ctor.sig), 'constructor de ' + s.cls.name, args, node, ctx);
              else {
                visitArgs(args, ctx);
                if (args.length > 0 && !hasUnknownBase(s.cls)) err(node, `La clase '${s.cls.name}' no tiene constructor, así que no acepta argumentos (se pasaron ${args.length}).`);
              }
              return s.cls.name;
            }
          } else expr(c, ctx);
          visitArgs(args, ctx);
          return 'any';
        }
        case 'ArrowFunctionExpression': return arrowFn(node, ctx);
        case 'SpreadElement': expr(node.argument, ctx); return 'any';
        default: return 'any';
      }
    }

    function assignment(node, ctx) {
      const left = node.left;
      const op = node.operator;
      let lt;
      let target;
      if (left.type === 'Identifier') {
        const s = resolve(left.name, left, ctx.scope);
        if (!s) { val(node.right, ctx); return 'any'; }
        lt = s.type;
        types.set(left, lt);
        if (left.loc) s.refs.add(left.loc.line);
        target = `la variable '${left.name}'`;
        if (s.kind === 'constante') err(left, `No se puede modificar la constante '${left.name}' porque se declaró con const.`);
        else if (s.kind === 'función' || s.kind === 'clase' || s.kind === 'importación') {
          err(left, `No se puede asignar un valor a '${left.name}' porque es ${KIND_ART[s.kind]}.`);
        }
        if (op !== '=') s.used = true;
      } else {
        lt = expr(left, ctx);
        target = left.type === 'MemberExpression' && !left.computed ? `el miembro '${left.property.name}'` : 'el elemento del arreglo';
      }
      const rt = val(node.right, ctx, op === '=' ? lt : undefined);
      if (op === '=') {
        if (!canAssign(lt, rt, node.right)) {
          const hint = isArith(lt) && isArith(rt) ? ' Se perdería información; usa un tipo más amplio o una conversión.' : '';
          err(node.right, `No se puede asignar un valor de tipo ${rt} a ${target} de tipo ${lt}.${hint}`);
        }
      } else if (op === '??=' || op === '&&=' || op === '||=') {
        if (!canAssign(lt, rt, node.right)) err(node.right, `No se puede asignar un valor de tipo ${rt} a ${target} de tipo ${lt}.`);
      } else {
        const base = op.slice(0, -1);
        const r = binaryType(base, lt, rt, node, node.right, op);
        const ok = lt === 'any' || r === 'any' || (isArith(lt) && isArith(r) && lt !== 'char') || (lt === 'string' && base === '+') || canAssign(lt, r);
        if (!ok) err(node, `El resultado de '${op}' es de tipo ${r} y no se puede guardar en ${target} de tipo ${lt}.`);
      }
      return lt;
    }

    // Las condiciones son estrictas: deben ser bool (no vale 0, "" ni null como en JavaScript)
    function cond(test, ctx, what) {
      const t = val(test, ctx);
      if (t !== 'bool' && t !== 'any') err(test, `La condición del ${what.startsWith('operador') ? what : `'${what}'`} debe ser de tipo bool, pero es de tipo ${t}.`);
    }

    // =====================================================================
    //  Instrucciones
    // =====================================================================
    const withScope = (ctx, kind, label) => Object.assign({}, ctx, { scope: new Scope(kind, ctx.scope, label) });
    const inLoop = (ctx) => Object.assign({}, ctx, { loop: true });
    const blockLabel = (n) => 'bloque (línea ' + n.loc.line + ')';

    // Analiza una lista de instrucciones: primero hoisting y luego cada una en orden, avisando del código inalcanzable
    function analyzeStatementList(list, ctx) {
      hoist(list, ctx);
      let dead = false;
      let warned = false;
      for (const s of list) {
        if (dead && !warned && s.type !== 'FunctionDeclaration' && s.type !== 'ClassDeclaration' && s.type !== 'EmptyStatement') {
          warn(s, 'Código inalcanzable: nunca se ejecutará porque la instrucción anterior termina el flujo (return, break, continue o throw).');
          warned = true;
        }
        stmt(s, ctx);
        if (!dead && term(unwrap(s), 'exits')) dead = true;
      }
    }
    function sub(s, ctx) {
      if (!s) return;
      if (s.type === 'BlockStatement') stmt(s, ctx);
      else analyzeStatementList([s], withScope(ctx, 'block', blockLabel(s)));
    }
    function defer(f) { queue.push(f); }

    function functionBody(node, ctx, info) {
      const scope = new Scope('function', ctx.scope, info.label);
      const fctx = { scope, fn: info, loop: false, sw: false, cls: info.cls || ctx.cls };
      declareParams(node.params, fctx);
      analyzeStatementList(node.body.body, fctx);
      if (!info.isCtor && info.ret && info.ret !== 'void' && info.ret !== 'any' && !term(node.body, 'returns')) {
        err(node.id || node, `La función '${info.name}' debe devolver un valor de tipo ${info.ret} en todos los caminos posibles; a alguna rama le falta un 'return'.`);
      }
    }

    function literalText(n) {
      if (!n) return null;
      if (n.type === 'Literal') return n.raw;
      if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && isArith(n.argument.dataType)) return '-' + n.argument.raw;
      return null;
    }
    function varDecl(node, ctx) {
      const declared = node.dataType ? norm(node.dataType) : null;
      const isConst = node.kind === 'const';
      const target = node.kind === 'var' ? fnScope(ctx.scope) : ctx.scope;
      for (const d of node.declarations) {
        const name = d.id.name;
        let initT = null;
        if (d.init) initT = val(d.init, ctx, declared || undefined);
        else if (isConst) err(d.id, `La constante '${name}' debe tener un valor inicial.`);
        let type;
        if (declared) {
          type = declared;
          if (d.init && !canAssign(declared, initT, d.init)) {
            const hint = isArith(declared) && isArith(initT) ? ' Se perdería información; usa un tipo más amplio.' : '';
            err(d.init, `No se puede asignar un valor de tipo ${initT} a la variable '${name}' de tipo ${declared}.${hint}`);
          }
        } else type = initT ? widen(initT) : 'any';
        declare(target, name, isConst ? 'constante' : 'variable', type, d.id, { varStyle: node.kind === 'var', value: literalText(d.init) });
        types.set(d.id, type);
        types.set(d, type);
        if (target.later.get(name) === d.id.loc.line) target.later.delete(name); // ya quedó declarada
      }
    }

    function classStmt(node, ctx) {
      const info = clsInfos.get(node);
      if (!info) return;
      const cctx = Object.assign({}, ctx, { cls: info });
      if (node.superClass && node.superClass.name !== info.name) {
        const sym = resolve(node.superClass.name, node.superClass, ctx.scope);
        if (sym) {
          sym.used = true;
          if (!sym.cls && sym.kind !== 'importación' && sym.type !== 'any') err(node.superClass, `'${sym.name}' no es una clase, no se puede usar con 'extends'.`);
        }
      }
      for (const m of node.body) {
        if (m.type === 'FieldDefinition') {
          if (m.init) {
            const f = info.fields.get(m.id.name);
            const t = val(m.init, cctx, f ? f.type : undefined);
            if (m.dataType && !canAssign(norm(m.dataType), t, m.init)) err(m.init, `No se puede asignar un valor de tipo ${t} al campo '${m.id.name}' de tipo ${norm(m.dataType)}.`);
          } else if (m.kind === 'const') err(m.id, `La constante '${m.id.name}' debe tener un valor inicial.`);
        } else {
          const isCtor = m.kind === 'constructor';
          const meth = isCtor ? null : info.methods.get(m.id.name);
          const ret = isCtor ? 'void' : (meth && meth.node === m ? meth.ret : (m.returnType ? norm(m.returnType) : 'any'));
          const finfo = { name: isCtor ? `constructor de ${info.name}` : `${info.name}.${m.id.name}`, ret, isCtor, cls: info, label: `${isCtor ? 'constructor' : 'método'} ${info.name}${isCtor ? '' : '.' + m.id.name}` };
          defer(() => functionBody(m, cctx, finfo));
        }
      }
    }

    // Analiza una instrucción. Los cuerpos de funciones y métodos no se revisan aquí: se encolan con defer()
    // y se revisan al final, así pueden usar variables globales declaradas después de ellas.
    function stmt(s, ctx) {
      switch (s.type) {
        case 'EmptyStatement': return;
        case 'VariableDeclaration': varDecl(s, ctx); return;
        case 'FunctionDeclaration': {
          const sym = fnSyms.get(s);
          if (!sym || !s.id) return;
          const info = { name: s.id.name, ret: sym.ret, label: 'función ' + s.id.name };
          defer(() => functionBody(s, ctx, info));
          return;
        }
        case 'ClassDeclaration': classStmt(s, ctx); return;
        case 'ExpressionStatement': {
          const e = s.expression;
          expr(e, ctx);
          if (['Literal', 'Identifier', 'BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'MemberExpression'].includes(e.type) &&
              !(e.type === 'Literal' && e.dataType === 'string')) { // un texto suelto es válido (ej. 'use strict')
            warn(e, 'Esta expresión no hace nada: calcula un valor que no se guarda ni se usa.');
          }
          return;
        }
        case 'BlockStatement': analyzeStatementList(s.body, withScope(ctx, 'block', blockLabel(s))); return;
        case 'IfStatement':
          cond(s.test, ctx, 'if');
          sub(s.consequent, ctx);
          if (s.alternate) sub(s.alternate, ctx);
          return;
        case 'WhileStatement':
          cond(s.test, ctx, 'while');
          sub(s.body, inLoop(ctx));
          return;
        case 'DoWhileStatement':
          sub(s.body, inLoop(ctx));
          cond(s.test, ctx, 'do-while');
          return;
        case 'ForStatement': {
          const fctx = withScope(ctx, 'block', 'ciclo for (línea ' + s.loc.line + ')');
          if (s.init) { if (s.init.type === 'VariableDeclaration') { hoist([s.init], fctx); varDecl(s.init, fctx); } else expr(s.init, fctx); }
          if (s.test) cond(s.test, fctx, 'for');
          if (s.update) expr(s.update, fctx);
          sub(s.body, inLoop(fctx));
          return;
        }
        case 'ForInStatement': case 'ForOfStatement': {
          const fctx = withScope(ctx, 'block', 'ciclo for (línea ' + s.loc.line + ')');
          const rt = val(s.right, ctx);
          const isOf = s.type === 'ForOfStatement';
          let et = 'any';
          if (isOf) {
            if (isArr(rt)) et = elemOf(rt);
            else if (rt === 'string') et = 'string';
            else if (rt !== 'any' && rt !== 'object' && !classes.has(rt)) err(s.right, `'for ... of' necesita un arreglo o un texto, pero se encontró ${rt}.`);
          } else {
            et = 'string';
            if (isArith(rt) || rt === 'bool') err(s.right, `'for ... in' necesita un objeto o un arreglo, pero se encontró ${rt}.`);
          }
          if (s.left.type === 'VariableDeclaration') {
            const d = s.left.declarations[0];
            const dt = s.left.dataType ? norm(s.left.dataType) : null;
            if (dt && isOf && !canAssign(dt, et)) err(d.id, `La variable '${d.id.name}' es de tipo ${dt}, pero los elementos recorridos son de tipo ${et}.`);
            const sym = declare(fctx.scope, d.id.name, s.left.kind === 'const' ? 'constante' : 'variable', dt || et, d.id, { used: false });
            types.set(d.id, sym.type);
          } else expr(s.left, fctx);
          sub(s.body, inLoop(fctx));
          return;
        }
        case 'SwitchStatement': {
          const dt = val(s.discriminant, ctx);
          const sctx = Object.assign(withScope(ctx, 'block', 'switch (línea ' + s.loc.line + ')'), { sw: true });
          const vistos = new Map();
          let defaults = 0;
          s.cases.forEach((c) => {
            if (c.test) {
              const t = val(c.test, sctx);
              if (!comparable(dt, t)) err(c.test, `El valor del 'case' es de tipo ${t}, pero el 'switch' evalúa un valor de tipo ${dt}.`);
              if (c.test.type === 'Literal') {
                const k = c.test.dataType + ':' + String(c.test.value);
                if (vistos.has(k)) err(c.test, `El valor ${c.test.raw} ya aparece en otro 'case' (línea ${vistos.get(k)}).`);
                else vistos.set(k, c.test.loc.line);
              }
            } else if (++defaults > 1) err(c, "Un 'switch' solo puede tener un 'default'.");
          });
          analyzeStatementList(s.cases.flatMap((c) => c.consequent), sctx);
          return;
        }
        case 'ReturnStatement': {
          const f = ctx.fn;
          if (!f) {
            if (s.argument) expr(s.argument, ctx);
            err(s, "'return' solo puede usarse dentro de una función.");
            return;
          }
          if (s.argument) {
            const t = val(s.argument, ctx, f.ret && f.ret !== 'void' ? f.ret : undefined);
            if (f.ret === 'void') err(s, f.isCtor ? 'Un constructor no puede devolver un valor.' : `La función '${f.name}' es de tipo void y no puede devolver un valor.`);
            else if (f.ret && !canAssign(f.ret, t, s.argument)) err(s.argument, `La función '${f.name}' debe devolver un valor de tipo ${f.ret}, pero 'return' devuelve ${t}.`);
          } else if (f.ret && f.ret !== 'void' && f.ret !== 'any') {
            err(s, `La función '${f.name}' debe devolver un valor de tipo ${f.ret}, pero este 'return' no devuelve nada.`);
          }
          return;
        }
        case 'BreakStatement':
          if (!ctx.loop && !ctx.sw) err(s, "'break' solo puede usarse dentro de un ciclo o de un 'switch'.");
          return;
        case 'ContinueStatement':
          if (!ctx.loop) err(s, "'continue' solo puede usarse dentro de un ciclo.");
          return;
        case 'PrintStatement': s.arguments.forEach((a) => (a.type === 'SpreadElement' ? expr(a.argument, ctx) : val(a, ctx))); return;
        case 'ThrowStatement': val(s.argument, ctx); return;
        case 'TryStatement':
          stmt(s.block, ctx);
          if (s.handler) {
            const hctx = withScope(ctx, 'block', 'catch (línea ' + s.handler.loc.line + ')');
            if (s.handler.param) { const sym = declare(hctx.scope, s.handler.param.name, 'variable', 'any', s.handler.param, { used: true }); types.set(s.handler.param, sym.type); }
            analyzeStatementList(s.handler.body.body, hctx);
          }
          if (s.finalizer) stmt(s.finalizer, ctx);
          return;
        case 'ImportDeclaration':
          for (const sp of s.specifiers) {
            if (!sp.local) continue;
            const sym = declare(ctx.scope, sp.local.name, 'importación', 'any', sp.local);
            types.set(sp.local, sym.type);
          }
          return;
        case 'ExportNamedDeclaration':
          if (s.declaration) {
            stmt(s.declaration, ctx);
            markExported(s.declaration, ctx);
          }
          if (!s.source) {
            for (const sp of s.specifiers) {
              const sym = ctx.scope.symbols.get(sp.local.name) || resolve(sp.local.name, sp.local, ctx.scope);
              if (sym) sym.used = true;
            }
          }
          return;
        case 'ExportDefaultDeclaration': {
          const d = s.declaration;
          if (!d) return;
          if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') { stmt(d, ctx); markExported(d, ctx); } else val(d, ctx);
          return;
        }
        case 'ExportAllDeclaration': return;
        default:
          eachChild(s, (c) => { if (c.type && /Expression$/.test(c.type)) expr(c, ctx); });
      }
    }
    function markExported(d, ctx) {
      const names = d.type === 'VariableDeclaration' ? d.declarations.map((x) => x.id.name) : (d.id ? [d.id.name] : []);
      names.forEach((n) => { const sym = ctx.scope.symbols.get(n); if (sym) sym.used = true; });
    }

    // =====================================================================
    //  Ejecución del análisis
    // =====================================================================
    const global = new Scope('global', null, 'global');
    // Los predefinidos se declaran en el ámbito global pero no aparecen en la tabla de símbolos
    const anyId = { loc: null };
    const declareBuiltin = (name, kind, type) => {
      declare(global, name, kind, type, anyId, { builtin: true, used: true });
      allSymbols.pop();
    };
    BUILTIN_VALUES.forEach((n) => declareBuiltin(n, 'variable', 'any'));
    Object.keys(BUILTIN_FUNCS).forEach((n) => declareBuiltin(n, 'función', mkSig([{ name: 'valor', type: 'any', rest: true }], BUILTIN_FUNCS[n])));
    ['Infinity', 'NaN'].forEach((n) => declareBuiltin(n, 'constante', 'float'));

    global.next = 0; // los predefinidos no ocupan direcciones del programa
    const ctx0 = { scope: global, fn: null, loop: false, sw: false, cls: null };
    try {
      analyzeStatementList(ast.body, ctx0);
      for (let i = 0; i < queue.length; i++) queue[i]();
    } catch (e) {
      errors.push({ message: 'Error interno del análisis semántico: ' + (e && e.message ? e.message : e), severity: 'error', line: 1, column: 1, length: 1 });
    }

    // Advertencias por símbolos sin usar (los que empiezan con '_' se omiten a propósito)
    for (const s of allSymbols) {
      if (s.used || s.detached || s.name.startsWith('_')) continue;
      if (s.kind === 'variable' || s.kind === 'constante') warn(s.idNode, `La variable '${s.name}' se declara pero nunca se usa.`);
      else if (s.kind === 'importación') warn(s.idNode, `Lo importado '${s.name}' nunca se usa.`);
    }

    // Salida ordenada por posición; la tabla de símbolos se entrega sin datos internos (idNode, etc.)
    const byPos = (a, b) => a.line - b.line || a.column - b.column;
    errors.sort(byPos);
    warnings.sort(byPos);
    const symbols = allSymbols.filter((s) => !s.detached).map((s) => ({
      name: s.name, kind: s.kind, type: s.type, scope: s.scope, line: s.line, column: s.column, length: s.length, used: !!s.used,
      address: s.address === undefined ? null : s.address, value: s.value === undefined ? null : s.value,
      refs: [...s.refs].sort((a, b) => a - b),
    }));
    return { errors, warnings, symbols, types };
  }

  // Compatible con Node.js (require) y con el navegador (<script src>)
  if (typeof module !== 'undefined' && module.exports) module.exports = { analyze };
  else window.analyzeProgram = analyze;
})();
