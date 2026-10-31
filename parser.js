'use strict';

/**
 * ANALIZADOR SINTÁCTICO (Paso 2 del compilador)
 * Recibe la lista de tokens del léxico y comprueba que formen instrucciones
 * válidas según la gramática. Si todo está bien, construye el AST
 * (árbol de sintaxis abstracta) que usará el análisis semántico.
 *
 * Técnica: descenso recursivo (una función por regla de la gramática) y
 * precedencia de operadores por niveles.
 *
 * GRAMÁTICA (resumen):
 *
 *   programa      -> instrucción* EOF
 *   instrucción   -> declaración | función | clase | if | while | do-while | for
 *                  | switch | return | break | continue | print | throw | try
 *                  | bloque | ';' | expresión ';'
 *   declaración   -> (TIPO | let | const | var) [TIPO] ID ['=' expr] (',' ID ['=' expr])* ';'
 *   función       -> (func | function) ID '(' params ')' ['->' TIPO] bloque
 *                  | TIPO ID '(' params ')' bloque
 *   if            -> 'if' '(' expr ')' instrucción ['else' instrucción]
 *   while         -> 'while' '(' expr ')' instrucción
 *   do-while      -> 'do' instrucción 'while' '(' expr ')' ';'
 *   for           -> 'for' '(' [init] ';' [expr] ';' [expr] ')' instrucción
 *                  | 'for' '(' (declaración sin ';' | ID) ('of' | 'in') expr ')' instrucción
 *   switch        -> 'switch' '(' expr ')' '{' ('case' expr ':' instrucción* | 'default' ':' instrucción*)* '}'
 *   print         -> 'print' '(' [args] ')' ';'  |  'print' expr (',' expr)* ';'
 *   try           -> 'try' bloque ['catch' ['(' ID ')'] bloque] ['finally' bloque]
 *   clase         -> 'class' ID ['extends' ID] '{' miembro* '}'
 *   import        -> 'import' STRING ';'
 *                  | 'import' [ID] [',' ] ['{' (ID ['as' ID]),* '}' | '*' 'as' ID] 'from' STRING ';'
 *   export        -> 'export' declaración
 *                  | 'export' '{' (ID ['as' ID]),* '}' ['from' STRING] ';'
 *                  | 'export' '*' ['as' ID] 'from' STRING ';'
 *                  | 'export' 'default' (función | clase | expr ';')
 *   (import y export solo se permiten al nivel principal del programa)
 *   expresión     -> asignación (',' asignación)*      (operador coma: devuelve el último valor)
 *
 *   Expresiones, de menor a mayor precedencia:
 *     asignación (= += -= ...)  derecha→izquierda
 *     ternario  ?:
 *     ??   ||   &&   |   ^   &   == != === !==   < > <= >=   << >> >>>   + -   * / %
 *     ** (derecha→izquierda)
 *     unarios  ! - + ~ ++ -- typeof
 *     postfijos  x++  x--  f(...)  a[i]  a.b  a?.b
 *     primarios  número, cadena, true, false, null, ID, this, ( expr ), [ ... ], { ... }, new, (a, b) => ...
 *
 * Los errores no detienen el análisis: el parser se "recupera" y sigue, de modo
 * que reporta varios errores en una sola pasada.
 */

const MAX_DEPTH = 200;   // protección contra anidamientos absurdos (pila de llamadas)
const MAX_ERRORS = 50;

const STATEMENT_KEYWORDS = new Set([
  'if', 'while', 'do', 'for', 'switch', 'return', 'break', 'continue', 'print',
  'throw', 'try', 'func', 'function', 'let', 'const', 'var', 'class',
]);

// Operadores binarios por nivel, de menor a mayor precedencia
const BINARY_LEVELS = [
  ['??'], ['||'], ['&&'], ['|'], ['^'], ['&'],
  ['==', '!=', '===', '!=='],
  ['<', '>', '<=', '>='],
  ['<<', '>>', '>>>'],
  ['+', '-'],
  ['*', '/', '%'],
];
const LOGICAL_OPS = new Set(['??', '||', '&&']);
const UNARY_OPS = new Set(['!', '-', '+', '~']);
const OPERATOR_TYPES = new Set(['ASSIGNMENT', 'ARITHMETIC', 'COMPARISON', 'LOGICAL', 'BITWISE', 'INCDEC', 'OPERATOR']);

// ---------- utilidades sobre tokens ----------
function endOf(tok) {
  const parts = tok.lexeme.split('\n');
  if (parts.length === 1) return { line: tok.line, column: tok.column + tok.lexeme.length };
  return { line: tok.line + parts.length - 1, column: parts[parts.length - 1].length + 1 };
}

function describe(tok) {
  const l = tok.lexeme;
  switch (tok.type) {
    case 'EOF': return 'el final del código';
    case 'KEYWORD': return `la palabra reservada '${l}'`;
    case 'TYPE': return `el tipo de dato '${l}'`;
    case 'IDENTIFIER': return `el identificador '${l}'`;
    case 'INT': case 'FLOAT': return `el número ${l}`;
    case 'STRING': return `la cadena ${l.length > 22 ? l.slice(0, 20) + '…' : l}`;
    default: return `'${l}'`;
  }
}

class ParseError extends Error {
  constructor(message, pos, length = 1) {
    super(message);
    this.line = pos.line;
    this.column = pos.column;
    this.length = Math.max(1, length);
    this.reported = false;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.errors = [];
    this.depth = 0;
    this.nested = 0; // > 0 cuando estamos dentro de un bloque, función, clase o cuerpo de if/while/for
  }

  // =====================================================================
  //  Punto de entrada
  // =====================================================================
  run() {
    const body = [];
    try {
      while (!this.isEOF()) {
        const before = this.pos;
        const s = this.parseStatementSafe();
        if (s) body.push(s);
        if (this.pos === before) this.advance();
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      this.errors.push({ message: 'El código es demasiado complejo (anidamiento excesivo).', line: 1, column: 1, length: 1 });
    }
    const eof = this.tokens[this.tokens.length - 1];
    const ast = {
      type: 'Program',
      body,
      loc: { line: 1, column: 1, endLine: eof.line, endColumn: eof.column },
    };
    return { ast, errors: this.errors };
  }

  // =====================================================================
  //  Lectura de tokens
  // =====================================================================
  peek(n = 0) { return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)]; }
  prevTok() { return this.pos > 0 ? this.tokens[this.pos - 1] : null; }
  isEOF() { return this.peek().type === 'EOF'; }
  advance() {
    const t = this.peek();
    if (t.type !== 'EOF') this.pos++;
    return t;
  }
  at(s, n = 0) {
    const t = this.peek(n);
    return t.type !== 'STRING' && t.type !== 'EOF' && t.lexeme === s;
  }
  eat(s) { return this.at(s) ? this.advance() : null; }

  // ¿el token actual está en una línea posterior a la del token anterior?
  foundOnNewLine() {
    const p = this.prevTok();
    return !!p && this.peek().line > endOf(p).line;
  }

  // =====================================================================
  //  Nodos y ubicaciones
  // =====================================================================
  startOf(item) {
    return item.loc ? { line: item.loc.line, column: item.loc.column } : { line: item.line, column: item.column };
  }

  mk(type, start, props) {
    const s = this.startOf(start);
    const p = this.prevTok();
    const e = p ? endOf(p) : s;
    return Object.assign({ type }, props, {
      loc: { line: s.line, column: s.column, endLine: e.line, endColumn: e.column },
    });
  }

  ident(tok) { return this.mk('Identifier', tok, { name: tok.lexeme }); }

  // =====================================================================
  //  Errores
  // =====================================================================
  errAtToken(tok, message) {
    return new ParseError(message, tok, tok.lexeme.split('\n')[0].length);
  }
  errAfterPrev(message) {
    const p = this.prevTok();
    return new ParseError(message, p ? endOf(p) : { line: 1, column: 1 }, 1);
  }
  errAtNode(node, message) {
    const l = node.loc;
    return new ParseError(message, l, l.endLine === l.line ? l.endColumn - l.column : 1);
  }

  // "Se esperaba X" (o "Falta X" cuando lo que sigue está en otra línea / fin de archivo)
  expectedError(thing, phrase = '') {
    const found = this.peek();
    const tail = phrase ? ' ' + phrase : '';
    if (this.prevTok() && (this.isEOF() || this.foundOnNewLine())) {
      return this.errAfterPrev(`Falta ${thing}${tail}.`);
    }
    return this.errAtToken(found, `Se esperaba ${thing}${tail}, pero se encontró ${describe(found)}.`);
  }

  expectedExpression() {
    const found = this.peek();
    if (found.type === 'SYMBOL') {
      return this.errAtToken(found, `El símbolo '${found.lexeme}' no forma parte de ninguna instrucción. Solo puede usarse dentro de cadenas o comentarios.`);
    }
    const p = this.prevTok();
    const after = p && (OPERATOR_TYPES.has(p.type) || (p.type === 'DELIMITER' && ['(', '[', ','].includes(p.lexeme)))
      ? ` después de '${p.lexeme}'` : '';
    if (p && (this.isEOF() || this.foundOnNewLine())) return this.errAfterPrev(`Falta una expresión${after}.`);
    return this.errAtToken(found, `Se esperaba una expresión${after}, pero se encontró ${describe(found)}.`);
  }

  report(err) {
    if (err.reported) return;
    err.reported = true;
    const last = this.errors[this.errors.length - 1];
    if (last && last.line === err.line && last.column === err.column) return;
    if (this.errors.length >= MAX_ERRORS) return;
    this.errors.push({ message: err.message, line: err.line, column: err.column, length: err.length });
  }

  expect(s, phrase) {
    if (this.at(s)) return this.advance();
    throw this.expectedError(`'${s}'`, phrase);
  }

  // Cierre de ( [ { : "Falta ')' para cerrar el '(' abierto en la línea N."
  // Se señala el lugar donde debería ir el cierre: justo después de lo último que se leyó bien.
  closeError(closer, openTok) {
    return this.errAfterPrev(`Falta '${closer}' para cerrar el '${openTok.lexeme}' abierto en la línea ${openTok.line}.`);
  }
  expectClose(closer, openTok) {
    if (this.at(closer)) return this.advance();
    throw this.closeError(closer, openTok);
  }
  // Igual, pero si lo que sigue es '{' se reporta el error y se continúa (recuperación suave)
  expectCloseSoft(closer, openTok) {
    if (this.at(closer)) return this.advance();
    const err = this.closeError(closer, openTok);
    if (this.at('{')) { this.report(err); return null; }
    throw err;
  }

  expectSemicolon(phrase = 'al final de la instrucción') {
    if (this.at(';')) return this.advance();
    const err = this.expectedError("';'", phrase);
    if (this.isEOF() || this.at('}') || this.foundOnNewLine()) { this.report(err); return null; }
    throw err;
  }

  expectIdentifier(what) {
    const t = this.peek();
    if (t.type === 'IDENTIFIER') { this.advance(); return this.ident(t); }
    if (t.type === 'KEYWORD' || t.type === 'TYPE') {
      // Error "suave": se reporta y se sigue como si fuera un nombre válido, para no generar errores en cascada
      this.report(this.errAtToken(t, `'${t.lexeme}' es una palabra reservada; no se puede usar como ${what}.`));
      this.advance();
      return this.ident(t);
    }
    throw this.expectedError(`el ${what}`);
  }

  // =====================================================================
  //  Recuperación de errores
  // =====================================================================
  isStatementStart(t) {
    return t.type === 'TYPE' || (t.type === 'KEYWORD' && STATEMENT_KEYWORDS.has(t.lexeme));
  }

  // Avanza hasta un punto seguro: después de un ';', antes de un '}' o antes de una instrucción nueva.
  // Si hay un bloque '{ ... }' de por medio, lo salta completo.
  synchronize(startPos) {
    if (this.pos === startPos && !this.isEOF()) this.advance(); // siempre avanzar

    // Si el error ocurrió dentro de un '{' ya consumido (p. ej. un objeto literal), hay que cerrarlo primero
    let depth = 0;
    for (let i = startPos; i < this.pos; i++) {
      const k = this.tokens[i];
      if (k.type !== 'DELIMITER') continue;
      if (k.lexeme === '{') depth++;
      else if (k.lexeme === '}') depth--;
    }
    depth = Math.max(0, depth);

    while (!this.isEOF()) {
      if (depth === 0) {
        const p = this.prevTok();
        if (p && p.type === 'DELIMITER' && p.lexeme === ';' && this.pos > startPos) return;
        if (this.at('}')) return;
        if (this.pos > startPos && this.isStatementStart(this.peek())) return;
      }
      if (this.at('{')) depth++;
      else if (this.at('}')) {
        depth--;
        this.advance();
        if (depth === 0) return;
        continue;
      }
      this.advance();
    }
  }

  safely(fn) {
    const before = this.pos;
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.report(e);
      this.synchronize(before);
      return null;
    }
  }

  parseStatementSafe() { return this.safely(() => this.parseStatement()); }

  // =====================================================================
  //  Instrucciones
  // =====================================================================
  parseStatement() {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw this.errAtToken(this.peek(), 'Demasiados niveles de anidamiento.');
    }
    try { return this.parseStatementInner(); } finally { this.depth--; }
  }

  parseStatementInner() {
    const t = this.peek();

    if (t.type === 'KEYWORD') {
      switch (t.lexeme) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'do': return this.parseDoWhile();
        case 'for': return this.parseFor();
        case 'switch': return this.parseSwitch();
        case 'return': return this.parseReturn();
        case 'break': case 'continue': return this.parseJump();
        case 'print': return this.parsePrint();
        case 'throw': return this.parseThrow();
        case 'try': return this.parseTry();
        case 'func': case 'function': return this.parseFunction();
        case 'let': case 'const': case 'var': return this.parseVarDeclaration(true);
        case 'class': return this.parseClass();
        case 'else':
          throw this.errAtToken(t, "'else' sin un 'if' anterior. Cada 'else' debe ir justo después del cuerpo de un 'if'.");
        case 'case': case 'default':
          throw this.errAtToken(t, `'${t.lexeme}' solo se puede usar dentro de un 'switch'.`);
        case 'catch': case 'finally':
          throw this.errAtToken(t, `'${t.lexeme}' debe ir después de un bloque 'try'.`);
        case 'import': case 'export':
          if (this.nested > 0) {
            throw this.errAtToken(t, `'${t.lexeme}' solo se puede usar al nivel principal del programa, no dentro de bloques, funciones ni cuerpos de if/while/for.`);
          }
          return t.lexeme === 'import' ? this.parseImport() : this.parseExport();
        case 'in': case 'of': case 'extends':
          throw this.errAtToken(t, `'${t.lexeme}' no se puede usar aquí.`);
        default: break; // true, false, null, this, new, typeof... son expresiones
      }
    }
    if (t.type === 'TYPE') return this.isTypedFunction() ? this.parseFunction() : this.parseVarDeclaration(true);
    if (this.at('{')) return this.parseBlock();
    if (this.at(';')) { this.advance(); return this.mk('EmptyStatement', t, {}); }
    if (this.at('}')) throw this.errAtToken(t, "Llave de cierre '}' sin su '{' de apertura.");
    return this.parseExpressionStatement();
  }

  parseExpressionStatement() {
    const start = this.peek();
    const expression = this.parseExpression();
    this.expectSemicolon();
    return this.mk('ExpressionStatement', start, { expression });
  }

  // { instrucciones }
  parseBlock(phrase = 'para abrir el bloque') {
    const open = this.expect('{', phrase);
    const body = this.parseBraceItems(open, () => this.parseStatementSafe());
    return this.mk('BlockStatement', open, { body });
  }

  // Lee elementos hasta '}' (con recuperación). Si falta la '}', lo reporta pero no aborta.
  parseBraceItems(open, parseItem) {
    const items = [];
    this.nested++;
    try {
      while (!this.at('}') && !this.isEOF()) {
        const before = this.pos;
        const item = parseItem();
        if (item) items.push(item);
        if (this.pos === before) this.advance();
      }
    } finally { this.nested--; }
    if (this.at('}')) this.advance();
    else this.report(this.closeError('}', open));
    return items;
  }

  // Cuerpo de if / while / for / do / else
  parseBody(what) {
    if (this.isEOF() || this.at('}') || this.at('else')) {
      this.report(this.errAfterPrev(`Falta el cuerpo ${what}.`));
      return null;
    }
    this.nested++;
    try { return this.parseStatementSafe(); } finally { this.nested--; }
  }

  // =====================================================================
  //  Módulos: import / export
  // =====================================================================
  // 'as' y 'from' son palabras "contextuales": solo valen en estas instrucciones,
  // en cualquier otro lugar siguen siendo identificadores normales.
  atWord(s, n = 0) {
    const t = this.peek(n);
    return t.type === 'IDENTIFIER' && t.lexeme === s;
  }

  expectWord(s, phrase) {
    if (this.atWord(s)) return this.advance();
    throw this.expectedError(`'${s}'`, phrase);
  }

  parseModuleSource(phrase) {
    const t = this.peek();
    if (t.type !== 'STRING') throw this.expectedError('el nombre del módulo entre comillas', phrase);
    this.advance();
    return this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'string' });
  }

  // { a, b as c }   (para import: imported/local — para export: local/exported)
  parseNamedList(isImport) {
    const open = this.advance(); // {
    const specifiers = [];
    while (!this.at('}')) {
      const first = this.expectIdentifier(isImport ? 'nombre importado' : 'nombre exportado');
      let second = first;
      if (this.atWord('as')) {
        this.advance();
        second = this.expectIdentifier(isImport ? 'nombre local' : 'nombre público');
      }
      specifiers.push(isImport
        ? this.mk('ImportSpecifier', first, { imported: first, local: second })
        : this.mk('ExportSpecifier', first, { local: first, exported: second }));
      if (this.eat(',')) continue;
      const esFrom = this.atWord('from') && this.peek(1).type === 'STRING'; // es el 'from "modulo"', no otro nombre
      if (this.peek().type === 'IDENTIFIER' && !esFrom) {
        this.report(this.errAfterPrev("Falta ',' entre los nombres."));
        continue;
      }
      break;
    }
    this.expectClose('}', open);
    return specifiers;
  }

  parseImport() {
    const start = this.advance(); // import
    const specifiers = [];
    let source;

    if (this.peek().type === 'STRING') {
      source = this.parseModuleSource(); // import "modulo";
    } else {
      const t = this.peek();
      if (this.atWord('from') && this.peek(1).type === 'STRING') {
        throw this.errAtToken(t, "Falta indicar qué se importa antes de 'from'. Por ejemplo: import { nombre } from \"modulo\";");
      }
      let more = true;
      if (t.type === 'IDENTIFIER') { // import nombre ...
        const local = this.expectIdentifier('nombre importado');
        specifiers.push(this.mk('ImportDefaultSpecifier', local, { local }));
        more = !!this.eat(',');
      }
      if (more) {
        if (this.at('*')) {
          const star = this.advance();
          this.expectWord('as', "después de '*'");
          const local = this.expectIdentifier('nombre del módulo');
          specifiers.push(this.mk('ImportNamespaceSpecifier', star, { local }));
        } else if (this.at('{')) {
          specifiers.push(...this.parseNamedList(true));
        } else {
          throw this.expectedError("'{' o '*'", "después de 'import'");
        }
      }
      this.expectWord('from', 'después de lo que se importa');
      source = this.parseModuleSource("después de 'from'");
    }
    this.expectSemicolon();
    return this.mk('ImportDeclaration', start, { specifiers, source });
  }

  parseExport() {
    const start = this.advance(); // export

    if (this.at('default')) {
      this.advance();
      let declaration;
      if (this.at('func') || this.at('function')) declaration = this.parseFunction();
      else if (this.at('class')) declaration = this.parseClass();
      else { declaration = this.parseAssignment(); this.expectSemicolon(); }
      return this.mk('ExportDefaultDeclaration', start, { declaration });
    }

    if (this.at('*')) { // export * from "m";   export * as ns from "m";
      this.advance();
      let exported = null;
      if (this.atWord('as')) { this.advance(); exported = this.expectIdentifier('nombre exportado'); }
      this.expectWord('from', "después de '*'");
      const source = this.parseModuleSource("después de 'from'");
      this.expectSemicolon();
      return this.mk('ExportAllDeclaration', start, { exported, source });
    }

    if (this.at('{')) { // export { a, b as c };   export { a } from "m";
      const specifiers = this.parseNamedList(false);
      let source = null;
      if (this.atWord('from')) { this.advance(); source = this.parseModuleSource("después de 'from'"); }
      this.expectSemicolon();
      return this.mk('ExportNamedDeclaration', start, { declaration: null, specifiers, source });
    }

    // export int x = 1;   export func f() {}   export class A {}
    const t = this.peek();
    let declaration;
    if (t.type === 'TYPE') declaration = this.isTypedFunction() ? this.parseFunction() : this.parseVarDeclaration(true);
    else if (t.type === 'KEYWORD' && ['let', 'const', 'var'].includes(t.lexeme)) declaration = this.parseVarDeclaration(true);
    else if (t.type === 'KEYWORD' && (t.lexeme === 'func' || t.lexeme === 'function')) declaration = this.parseFunction();
    else if (t.type === 'KEYWORD' && t.lexeme === 'class') declaration = this.parseClass();
    else throw this.expectedError('una declaración (variable, función o clase)', "después de 'export'");
    return this.mk('ExportNamedDeclaration', start, { declaration, specifiers: [], source: null });
  }

  // ---------- Declaración de variables ----------
  parseVarDeclaration(requireSemi) {
    const start = this.peek();
    let kind;
    let dataType = null;
    if (start.type === 'KEYWORD') {
      kind = this.advance().lexeme;                          // let | const | var
      if (this.peek().type === 'TYPE') dataType = this.parseTypeName(); // const int x = 1;
    } else {
      kind = 'typed';                                        // int x = 1;
      dataType = this.parseTypeName();
    }
    const declarations = [];
    do {
      const id = this.expectIdentifier('nombre de la variable');
      let init = null;
      if (this.at('=')) { this.advance(); init = this.parseAssignment(); }
      declarations.push(this.mk('VariableDeclarator', id, { id, init }));
    } while (this.eat(','));
    if (requireSemi) this.expectSemicolon();
    return this.mk('VariableDeclaration', start, { kind, dataType, declarations });
  }

  // int  |  float[]  |  string[][]
  parseTypeName() {
    let name = this.advance().lexeme;
    while (this.at('[') && this.at(']', 1)) { this.advance(); this.advance(); name += '[]'; }
    return name;
  }
  expectTypeName(phrase) {
    if (this.peek().type !== 'TYPE') throw this.expectedError('un tipo de dato', phrase);
    return this.parseTypeName();
  }

  // ¿TIPO ID '(' ... ? (función estilo C)
  isTypedFunction() {
    let i = 1;
    while (this.at('[', i) && this.at(']', i + 1)) i += 2;
    return this.peek(i).type === 'IDENTIFIER' && this.at('(', i + 1);
  }

  // ---------- Funciones ----------
  parseFunction() {
    const start = this.peek();
    let returnType = null;
    if (start.type === 'TYPE') returnType = this.parseTypeName();
    else this.advance(); // func | function
    const id = this.expectIdentifier('nombre de la función');
    const params = this.parseParams('después del nombre de la función');
    if (!returnType && (this.at('->') || this.at(':'))) {
      this.advance();
      returnType = this.expectTypeName('después de la flecha del tipo de retorno');
    }
    const body = this.parseBlock('para abrir el cuerpo de la función');
    return this.mk('FunctionDeclaration', start, { id, params, returnType, body });
  }

  parseParams(phrase) {
    const open = this.expect('(', phrase || 'para abrir la lista de parámetros');
    const params = [];
    while (!this.at(')')) {
      params.push(this.parseParam());
      if (this.eat(',')) continue;
      const t = this.peek();
      if (t.type === 'TYPE' || t.type === 'IDENTIFIER') {
        // Otro parámetro sin coma de por medio: se reporta y se sigue leyendo
        this.report(this.errAfterPrev("Falta ',' entre los parámetros."));
        continue;
      }
      break;
    }
    this.expectClose(')', open);
    return params;
  }

  parseParam() {
    const start = this.peek();
    const rest = !!this.eat('...');
    const dataType = this.peek().type === 'TYPE' ? this.parseTypeName() : null;
    const id = this.expectIdentifier('nombre del parámetro');
    const defaultValue = this.eat('=') ? this.parseAssignment() : null;
    return this.mk('Parameter', start, { id, dataType, defaultValue, rest });
  }

  parseReturn() {
    const start = this.advance();
    let argument = null;
    if (!this.at(';') && !this.at('}') && !this.isEOF()) argument = this.parseExpression();
    this.expectSemicolon();
    return this.mk('ReturnStatement', start, { argument });
  }

  parseJump() {
    const start = this.advance();
    this.expectSemicolon();
    return this.mk(start.lexeme === 'break' ? 'BreakStatement' : 'ContinueStatement', start, {});
  }

  parseThrow() {
    const start = this.advance();
    const argument = this.parseExpression();
    this.expectSemicolon();
    return this.mk('ThrowStatement', start, { argument });
  }

  // ---------- Condicionales y ciclos ----------
  parseIf() {
    const start = this.advance();
    const open = this.expect('(', "después de 'if'");
    const test = this.parseExpression();
    this.expectCloseSoft(')', open);
    const consequent = this.parseBody("del 'if'");
    let alternate = null;
    if (this.at('else')) {
      this.advance();
      alternate = this.parseBody("del 'else'");
    }
    return this.mk('IfStatement', start, { test, consequent, alternate });
  }

  parseWhile() {
    const start = this.advance();
    const open = this.expect('(', "después de 'while'");
    const test = this.parseExpression();
    this.expectCloseSoft(')', open);
    const body = this.parseBody("del 'while'");
    return this.mk('WhileStatement', start, { test, body });
  }

  parseDoWhile() {
    const start = this.advance();
    const body = this.parseBody("del 'do'");
    if (!this.at('while')) throw this.expectedError("'while'", "después del cuerpo del 'do'");
    this.advance();
    const open = this.expect('(', "después de 'while'");
    const test = this.parseExpression();
    this.expectCloseSoft(')', open);
    this.expectSemicolon();
    return this.mk('DoWhileStatement', start, { body, test });
  }

  parseFor() {
    const start = this.advance();
    const open = this.expect('(', "después de 'for'");
    let init = null;
    let left = null;
    let iter = null; // 'of' | 'in'

    if (!this.at(';')) {
      if (this.isDeclStart()) {
        const decl = this.parseVarDeclaration(false);
        if (this.at('of') || this.at('in')) {
          if (decl.declarations.length !== 1 || decl.declarations[0].init) {
            throw this.errAtNode(decl, "La cabecera de 'for ... of/in' admite una sola variable y sin valor inicial.");
          }
          iter = this.advance().lexeme;
          left = decl;
        } else init = decl;
      } else {
        const expr = this.parseForExpressions();
        if (this.at('of') || this.at('in')) {
          if (!this.isAssignable(expr)) throw this.errAtNode(expr, "Antes de 'of'/'in' debe ir una variable.");
          iter = this.advance().lexeme;
          left = expr;
        } else init = expr;
      }
    }

    if (iter) {
      const right = this.parseExpression();
      this.expectCloseSoft(')', open);
      const body = this.parseBody("del 'for'");
      return this.mk(iter === 'of' ? 'ForOfStatement' : 'ForInStatement', start, { left, right, body });
    }

    this.expectSemicolon("en la cabecera del 'for'");
    const test = this.at(';') ? null : this.parseExpression();
    this.expectSemicolon("en la cabecera del 'for'");
    const update = this.at(')') ? null : this.parseForExpressions();
    this.expectCloseSoft(')', open);
    const body = this.parseBody("del 'for'");
    return this.mk('ForStatement', start, { init, test, update, body });
  }

  isDeclStart() {
    const t = this.peek();
    return t.type === 'TYPE' || (t.type === 'KEYWORD' && ['let', 'const', 'var'].includes(t.lexeme));
  }

  // En la cabecera del for se admite el operador coma: for (i = 0, j = 9; ...; i++, j--)
  parseForExpressions() { return this.parseExpression(); }

  // ---------- switch ----------
  parseSwitch() {
    const start = this.advance();
    const openP = this.expect('(', "después de 'switch'");
    const discriminant = this.parseExpression();
    this.expectCloseSoft(')', openP);
    const open = this.expect('{', "para abrir el cuerpo del 'switch'");
    const cases = this.parseBraceItems(open, () => this.safely(() => this.parseSwitchCase()));
    return this.mk('SwitchStatement', start, { discriminant, cases });
  }

  parseSwitchCase() {
    const t = this.peek();
    if (!this.at('case') && !this.at('default')) {
      this.report(this.errAtToken(t, "Dentro de un 'switch' solo puede haber 'case' o 'default'."));
      this.parseStatementSafe(); // se consume la instrucción suelta
      return null;
    }
    this.advance();
    const isCase = t.lexeme === 'case';
    const test = isCase ? this.parseExpression() : null;
    this.expect(':', isCase ? "después del valor del 'case'" : "después de 'default'");
    const consequent = [];
    while (!this.at('case') && !this.at('default') && !this.at('}') && !this.isEOF()) {
      const before = this.pos;
      const s = this.parseStatementSafe();
      if (s) consequent.push(s);
      if (this.pos === before) this.advance();
    }
    return this.mk('SwitchCase', t, { test, consequent });
  }

  // ---------- print ----------
  parsePrint() {
    const start = this.advance();

    // Forma print(a, b);  — si después del ')' no termina la instrucción, se reintenta como expresión
    if (this.at('(')) {
      const savePos = this.pos;
      const saveErrors = this.errors.length;
      try {
        const args = this.parseArguments();
        if (this.at(';') || this.at('}') || this.isEOF() || this.foundOnNewLine()) {
          this.expectSemicolon();
          return this.mk('PrintStatement', start, { arguments: args });
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
      }
      this.pos = savePos;
      this.errors.length = saveErrors;
    }

    // Forma print expr, expr;
    const args = [this.parseAssignment()];
    while (this.eat(',')) args.push(this.parseAssignment());
    this.expectSemicolon();
    return this.mk('PrintStatement', start, { arguments: args });
  }

  // ---------- try / catch / finally ----------
  parseTry() {
    const start = this.advance();
    const block = this.parseBlock("después de 'try'");
    let handler = null;
    let finalizer = null;
    if (this.at('catch')) {
      const c = this.advance();
      let param = null;
      if (this.at('(')) {
        const open = this.advance();
        param = this.expectIdentifier('nombre del error');
        this.expectClose(')', open);
      }
      const body = this.parseBlock("después de 'catch'");
      handler = this.mk('CatchClause', c, { param, body });
    }
    if (this.at('finally')) {
      this.advance();
      finalizer = this.parseBlock("después de 'finally'");
    }
    if (!handler && !finalizer) {
      this.report(this.errAfterPrev("Un 'try' necesita al menos un bloque 'catch' o 'finally'."));
    }
    return this.mk('TryStatement', start, { block, handler, finalizer });
  }

  // ---------- clases ----------
  parseClass() {
    const start = this.advance();
    const id = this.expectIdentifier('nombre de la clase');
    const superClass = this.eat('extends') ? this.expectIdentifier('nombre de la clase base') : null;
    const open = this.expect('{', 'para abrir el cuerpo de la clase');
    const body = this.parseBraceItems(open, () => this.safely(() => this.parseClassMember()));
    return this.mk('ClassDeclaration', start, { id, superClass, body });
  }

  parseClassMember() {
    const start = this.peek();
    let kind = null;
    let dataType = null;
    if (this.at('let') || this.at('const') || this.at('var')) kind = this.advance().lexeme;
    if (this.peek().type === 'TYPE') dataType = this.parseTypeName();
    const id = this.expectIdentifier('nombre del miembro');

    if (this.at('(')) { // método
      const params = this.parseParams('después del nombre del método');
      let returnType = dataType;
      if (!returnType && (this.at('->') || this.at(':'))) {
        this.advance();
        returnType = this.expectTypeName('después de la flecha del tipo de retorno');
      }
      const body = this.parseBlock('para abrir el cuerpo del método');
      return this.mk('MethodDefinition', start, {
        id, params, returnType, body, kind: id.name === 'constructor' ? 'constructor' : 'method',
      });
    }

    const init = this.eat('=') ? this.parseAssignment() : null; // campo
    this.expectSemicolon();
    return this.mk('FieldDefinition', start, { id, dataType, kind, init });
  }

  // =====================================================================
  //  Expresiones
  // =====================================================================
  // Expresión completa. Incluye el operador coma:  a = 1, b = 2   y   (a, b)
  // Donde la coma separa otras cosas (argumentos, elementos, declaraciones) se usa parseAssignment.
  parseExpression() {
    const first = this.parseAssignment();
    if (!this.at(',')) return first;
    const expressions = [first];
    while (this.eat(',')) expressions.push(this.parseAssignment());
    return this.mk('SequenceExpression', first, { expressions });
  }

  isAssignable(node) { return node.type === 'Identifier' || node.type === 'MemberExpression'; }

  parseAssignment() {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw this.errAtToken(this.peek(), 'Expresión demasiado anidada.');
    }
    try {
      const arrow = this.tryParseArrow();
      if (arrow) return arrow;

      const left = this.parseConditional();
      if (this.peek().type === 'ASSIGNMENT') {
        const op = this.advance();
        if (!this.isAssignable(left)) {
          throw this.errAtNode(left, 'No se puede asignar un valor a esta expresión: el lado izquierdo debe ser una variable, objeto.campo o arreglo[i].');
        }
        const right = this.parseAssignment();
        return this.mk('AssignmentExpression', left, { operator: op.lexeme, left, right });
      }
      return left;
    } finally { this.depth--; }
  }

  // x => ...   |   (a, b) => ...   |   () => ...
  tryParseArrow() {
    const t = this.peek();
    if (t.type === 'IDENTIFIER' && this.at('=>', 1)) {
      const idTok = this.advance();
      this.advance(); // =>
      const id = this.ident(idTok);
      const param = this.mk('Parameter', idTok, { id, dataType: null, defaultValue: null, rest: false });
      return this.finishArrow(t, [param]);
    }
    if (this.at('(')) {
      let depth = 0;
      let i = 0;
      for (; ; i++) {
        if (this.peek(i).type === 'EOF') return null;
        if (this.at('(', i)) depth++;
        else if (this.at(')', i) && --depth === 0) break;
      }
      if (!this.at('=>', i + 1)) return null;
      const params = this.parseParams();
      this.advance(); // =>
      return this.finishArrow(t, params);
    }
    return null;
  }

  finishArrow(start, params) {
    const body = this.at('{') ? this.parseBlock("después de '=>'") : this.parseAssignment();
    return this.mk('ArrowFunctionExpression', start, { params, body, expression: body.type !== 'BlockStatement' });
  }

  parseConditional() {
    const test = this.parseBinary(0);
    if (!this.at('?')) return test;
    this.advance();
    const consequent = this.parseAssignment();
    this.expect(':', 'en el operador ternario (condición ? valor1 : valor2)');
    const alternate = this.parseAssignment();
    return this.mk('ConditionalExpression', test, { test, consequent, alternate });
  }

  parseBinary(level) {
    if (level >= BINARY_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.type === 'STRING' || t.type === 'EOF' || !BINARY_LEVELS[level].includes(t.lexeme)) break;
      this.advance();
      const right = this.parseBinary(level + 1);
      left = this.mk(LOGICAL_OPS.has(t.lexeme) ? 'LogicalExpression' : 'BinaryExpression', left,
        { operator: t.lexeme, left, right });
    }
    return left;
  }

  parseUnary() {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw this.errAtToken(this.peek(), 'Expresión demasiado anidada.');
    }
    try {
      const t = this.peek();
      const isPrefixOp = (UNARY_OPS.has(t.lexeme) && ['LOGICAL', 'ARITHMETIC', 'BITWISE'].includes(t.type))
        || (t.type === 'KEYWORD' && t.lexeme === 'typeof');
      if (isPrefixOp) {
        this.advance();
        const argument = this.parseUnary();
        return this.mk('UnaryExpression', t, { operator: t.lexeme, argument });
      }
      if (t.type === 'INCDEC') {
        this.advance();
        const argument = this.parseUnary();
        if (!this.isAssignable(argument)) {
          throw this.errAtNode(argument, `El operador '${t.lexeme}' solo se puede aplicar a una variable.`);
        }
        return this.mk('UpdateExpression', t, { operator: t.lexeme, prefix: true, argument });
      }
      return this.parsePower();
    } finally { this.depth--; }
  }

  // a ** b ** c  =  a ** (b ** c)
  parsePower() {
    const base = this.parsePostfix();
    if (!this.at('**')) return base;
    this.advance();
    const right = this.parseUnary();
    return this.mk('BinaryExpression', base, { operator: '**', left: base, right });
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('(')) {
        const args = this.parseArguments();
        expr = this.mk('CallExpression', expr, { callee: expr, arguments: args, optional: false });
      } else if (this.at('[')) {
        expr = this.parseIndex(expr, false);
      } else if (this.at('.')) {
        this.advance();
        expr = this.parseMemberName(expr, false);
      } else if (this.at('?.')) {
        this.advance();
        if (this.at('(')) {
          const args = this.parseArguments();
          expr = this.mk('CallExpression', expr, { callee: expr, arguments: args, optional: true });
        } else if (this.at('[')) expr = this.parseIndex(expr, true);
        else expr = this.parseMemberName(expr, true);
      } else break;
    }
    if (this.peek().type === 'INCDEC' && !this.foundOnNewLine()) {
      if (!this.isAssignable(expr)) {
        throw this.errAtNode(expr, `El operador '${this.peek().lexeme}' solo se puede aplicar a una variable.`);
      }
      const op = this.advance();
      expr = this.mk('UpdateExpression', expr, { operator: op.lexeme, prefix: false, argument: expr });
    }
    return expr;
  }

  parseIndex(object, optional) {
    const open = this.advance(); // [
    const property = this.parseExpression();
    this.expectClose(']', open);
    return this.mk('MemberExpression', object, { object, property, computed: true, optional });
  }

  parseMemberName(object, optional) {
    const t = this.peek();
    if (t.type !== 'IDENTIFIER' && t.type !== 'KEYWORD' && t.type !== 'TYPE') {
      throw this.expectedError('el nombre de una propiedad', "después del '.'");
    }
    this.advance();
    const property = this.ident(t);
    return this.mk('MemberExpression', object, { object, property, computed: false, optional });
  }

  // ( expr, expr, ... )
  parseArguments() {
    const open = this.advance(); // (
    const args = [];
    if (!this.at(')')) {
      do {
        if (this.at(')')) break; // coma final
        args.push(this.parseAssignment());
      } while (this.eat(','));
    }
    this.expectClose(')', open);
    return args;
  }

  parsePrimary() {
    const t = this.peek();
    switch (t.type) {
      case 'INT':
        this.advance();
        return this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'int' });
      case 'FLOAT':
        this.advance();
        return this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'float' });
      case 'STRING':
        this.advance();
        return this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'string' });
      case 'IDENTIFIER':
        this.advance();
        return this.ident(t);
      case 'KEYWORD':
        switch (t.lexeme) {
          case 'true': case 'false':
            this.advance();
            return this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'bool' });
          case 'null':
            this.advance();
            return this.mk('Literal', t, { value: null, raw: 'null', dataType: 'null' });
          case 'undefined':
            this.advance();
            return this.mk('Literal', t, { value: undefined, raw: 'undefined', dataType: 'undefined' });
          case 'this':
            this.advance();
            return this.mk('ThisExpression', t, {});
          case 'new':
            return this.parseNew();
          default: break;
        }
        break;
      case 'DELIMITER':
        if (t.lexeme === '(') return this.parseParenthesized();
        if (t.lexeme === '[') return this.parseArrayLiteral();
        if (t.lexeme === '{') return this.parseObjectLiteral();
        break;
      default: break;
    }
    throw this.expectedExpression();
  }

  parseParenthesized() {
    const open = this.advance();
    const inner = this.parseExpression();
    const close = this.expectClose(')', open);
    const e = endOf(close);
    inner.parenthesized = true;
    inner.loc = { line: open.line, column: open.column, endLine: e.line, endColumn: e.column };
    return inner;
  }

  parseArrayLiteral() {
    const open = this.advance();
    const elements = [];
    if (!this.at(']')) {
      do {
        if (this.at(']')) break;
        elements.push(this.parseAssignment());
      } while (this.eat(','));
    }
    this.expectClose(']', open);
    return this.mk('ArrayExpression', open, { elements });
  }

  parseObjectLiteral() {
    const open = this.advance();
    const properties = [];
    if (!this.at('}')) {
      do {
        if (this.at('}')) break;
        properties.push(this.parseProperty());
      } while (this.eat(','));
    }
    this.expectClose('}', open);
    return this.mk('ObjectExpression', open, { properties });
  }

  parseProperty() {
    const t = this.peek();
    let key;
    if (t.type === 'IDENTIFIER' || t.type === 'KEYWORD' || t.type === 'TYPE') { this.advance(); key = this.ident(t); }
    else if (t.type === 'STRING') { this.advance(); key = this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: 'string' }); }
    else if (t.type === 'INT' || t.type === 'FLOAT') {
      this.advance();
      key = this.mk('Literal', t, { value: t.value, raw: t.lexeme, dataType: t.type === 'INT' ? 'int' : 'float' });
    } else throw this.expectedError('el nombre de una propiedad');

    if (this.eat(':')) {
      const value = this.parseAssignment();
      return this.mk('Property', key, { key, value, shorthand: false });
    }
    if (key.type === 'Identifier' && t.type === 'IDENTIFIER' && (this.at(',') || this.at('}'))) {
      return this.mk('Property', key, { key, value: key, shorthand: true });
    }
    throw this.expectedError("':'", 'después del nombre de la propiedad');
  }

  parseNew() {
    const start = this.advance();
    let callee = this.parsePrimary();
    while (this.at('.')) {
      this.advance();
      callee = this.parseMemberName(callee, false);
    }
    const args = this.at('(') ? this.parseArguments() : [];
    return this.mk('NewExpression', start, { callee, arguments: args });
  }
}

function parse(tokens) { return new Parser(tokens).run(); }

// Compatible con Node.js (require) y con el navegador (<script src="parser.js">)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Parser, ParseError, parse };
} else {
  window.Parser = Parser;
  window.parseTokens = parse;
}
