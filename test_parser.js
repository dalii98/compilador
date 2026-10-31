'use strict';
// Pruebas del analizador sintáctico.  Ejecutar:  node test_parser.js
const { Lexer } = require('./lexer');
const { parse } = require('./parser');

let fallos = 0;
let total = 0;
const check = (ok, msg) => { total++; if (!ok) { fallos++; console.log('FALLA:', msg); } };

function run(src) {
  const lex = new Lexer(src).tokenize();
  if (lex.errors.length) return { lexErrors: lex.errors, ast: null, errors: [] };
  const r = parse(lex.tokens);
  return { lexErrors: [], ast: r.ast, errors: r.errors };
}

// Representación compacta de expresiones para comparar la forma del árbol
function sx(n) {
  if (!n) return '_';
  switch (n.type) {
    case 'Literal': return n.raw;
    case 'Identifier': return n.name;
    case 'ThisExpression': return 'this';
    case 'BinaryExpression': case 'LogicalExpression': case 'AssignmentExpression':
      return `(${n.operator} ${sx(n.left)} ${sx(n.right)})`;
    case 'UnaryExpression': return `(${n.operator} ${sx(n.argument)})`;
    case 'UpdateExpression': return `(${n.operator}${n.prefix ? 'pre' : 'post'} ${sx(n.argument)})`;
    case 'ConditionalExpression': return `(?: ${sx(n.test)} ${sx(n.consequent)} ${sx(n.alternate)})`;
    case 'CallExpression': return `(call${n.optional ? '?' : ''} ${sx(n.callee)}${n.arguments.map((a) => ' ' + sx(a)).join('')})`;
    case 'NewExpression': return `(new ${sx(n.callee)}${n.arguments.map((a) => ' ' + sx(a)).join('')})`;
    case 'MemberExpression': return n.computed ? `(idx${n.optional ? '?' : ''} ${sx(n.object)} ${sx(n.property)})` : `(.${n.optional ? '?' : ''} ${sx(n.object)} ${n.property.name})`;
    case 'ArrayExpression': return `[${n.elements.map(sx).join(' ')}]`;
    case 'ObjectExpression': return `{${n.properties.map((p) => `${p.key.name || p.key.raw}:${sx(p.value)}`).join(' ')}}`;
    case 'ArrowFunctionExpression': return `(=> (${n.params.map((p) => p.id.name).join(' ')}) ${n.expression ? sx(n.body) : 'BLOCK'})`;
    case 'SequenceExpression': return `(seq ${n.expressions.map(sx).join(' ')})`;
    default: return `<${n.type}>`;
  }
}
const expr = (src) => {
  const r = run(src + ';');
  if (r.errors.length || !r.ast) return 'ERROR: ' + JSON.stringify(r.errors || r.lexErrors);
  return sx(r.ast.body[0].expression);
};

// ---------------------------------------------------------------
// 1) Programas válidos: no deben dar ningún error
// ---------------------------------------------------------------
const validos = {
  'vacío': '',
  'solo comentarios': '// hola\n/* nada */',
  'declaración tipada': 'int x = 5;',
  'declaración sin valor': 'int x;',
  'declaración múltiple': 'int a = 1, b = 2, c;',
  'let': 'let y = 3;',
  'const': 'const PI = 3.14;',
  'var sin valor': 'var z;',
  'const con tipo': 'const int N = 10;',
  'arreglo tipado': 'int[] arr = [1, 2, 3];',
  'matriz tipada': 'int[][] m = [[1], [2]];',
  'cadenas': 'string s = "hola"; string t = \'x\'; string u = `y`;',
  'bool/null': 'bool b = true; bool c = false; string n = null; let u = undefined;',
  'asignación simple': 'x = 5;',
  'asignación compuesta': 'x += 1; x -= 1; x *= 2; x /= 2; x %= 3; x **= 2; x &= 1; x |= 2; x ^= 3; x <<= 1; x >>= 1; x >>>= 1;',
  'asignación encadenada': 'a = b = c = 0;',
  'asignación a índice y miembro': 'arr[0] = 1; obj.x = 2; a.b[c].d = 3;',
  'incremento': 'i++; --j; ++k; l--;',
  'llamadas': 'f(); f(1); f(1, 2); f(1)(2); a.b(c); a?.b; a?.(1); a?.[0];',
  'new / this': 'x = new Foo(1, 2); y = new Bar; z = new a.B();',
  'flechas': 'f = x => x * 2; g = (a, b) => a + b; h = () => { return 1; }; k = (int a, int b) => a + b;',
  'literales compuestos': 'o = { a: 1, "b": 2, 3: 4, c }; l = [1, [2, 3], { x: 1 }];',
  'ternario': 'x = a ? b : c ? d : e;',
  'unarios': 'x = !a; y = -b; z = +c; w = ~d; t = typeof e;',
  'paréntesis': 'x = (1 + 2) * (3 - 4) / ((5));',
  'if': 'if (x) y = 1;',
  'if bloque': 'if (x > 1) { y = 1; }',
  'if/else': 'if (x) { y = 1; } else { y = 2; }',
  'else if': 'if (a) x = 1; else if (b) x = 2; else x = 3;',
  'while': 'while (i < 10) { i++; }',
  'while sin bloque': 'while (i < 10) i++;',
  'do-while': 'do { i++; } while (i < 10);',
  'for clásico': 'for (int i = 0; i < 10; i++) { print(i); }',
  'for let': 'for (let i = 0; i < 3; i += 1) x = i;',
  'for expr': 'for (i = 0; i < 3; i++) x = i;',
  'for vacío': 'for (;;) { break; }',
  'for con comas': 'for (i = 0, j = 10; i < j; i++, j--) {}',
  'for of': 'for (let x of arr) { print(x); }',
  'for in': 'for (k in obj) print(k);',
  'for of tipado': 'for (int x of arr) {}',
  'switch': 'switch (x) { case 1: y = 1; break; case 2: case 3: y = 2; break; default: y = 0; }',
  'switch vacío': 'switch (x) { }',
  'func con tipos': 'func suma(int a, int b) -> int { return a + b; }',
  'func sin tipos': 'func f(a, b) { return a; }',
  'function js': 'function f(a, b = 2, ...resto) { return a; }',
  'función estilo C': 'int cuadrado(int n) { return n * n; }',
  'función void': 'void saludar() { print("hola"); }',
  'función arreglo': 'int[] lista(int n) { return [n]; }',
  'función con dos puntos': 'func f(x): int { return x; }',
  'recursión': 'func fact(int n) -> int { if (n <= 1) { return 1; } return n * fact(n - 1); }',
  'return vacío': 'func f() { return; }',
  'break/continue': 'while (true) { if (x) break; else continue; }',
  'print paréntesis': 'print(x);',
  'print sin paréntesis': 'print x;',
  'print varios': 'print(a, b, c);',
  'print varios sin paréntesis': 'print a, b;',
  'print expresión que empieza con (': 'print (a + b) * 2;',
  'print cadena': 'print("hola");',
  'print vacío': 'print();',
  'try/catch': 'try { f(); } catch (e) { print(e); }',
  'try/finally': 'try { f(); } finally { g(); }',
  'try/catch/finally': 'try { f(); } catch { g(); } finally { h(); }',
  'throw': 'throw "error";',
  'clase': 'class A { int x = 1; constructor(int v) { this.x = v; } int get() { return this.x; } }',
  'clase con herencia': 'class B extends A { }',
  'bloque suelto': '{ int a = 1; { int b = 2; } }',
  'instrucciones vacías': ';;;',
  'sin punto y coma tras }': 'func f() { } int x = 1;',
  'comentarios en medio': 'int /* tipo */ x = /* valor */ 5; // fin',
  'coma en paréntesis': 'x = (a, b); y = (1, 2, 3);',
  'coma como instrucción': 'a = 1, b = 2;',
  'coma en condición': 'if ((a, b)) x; while (i++, i < 3) y;',
  'coma en índice': 'v = a[i, j];',
  'return con coma': 'func f() { return a, b; }',
  'import efecto': 'import "modulo";',
  'import por defecto': 'import x from "modulo";',
  'import con nombres': 'import { a, b as c } from "modulo";',
  'import con coma final': 'import { a, } from "modulo";',
  'import vacío': 'import { } from "modulo";',
  'import todo': 'import * as util from "modulo";',
  'import mixto': 'import x, { a, b as c } from "modulo";',
  'import mixto con *': 'import x, * as todo from "modulo";',
  'import con comillas simples': "import { a } from 'modulo';",
  'from y as como variables': 'int from = 1; int as = 2; from = as;',
  'export variable': 'export int x = 5;',
  'export const': 'export const y = 1, z = 2;',
  'export func': 'export func f(int a) -> int { return a; }',
  'export función estilo C': 'export int g(int a) { return a; }',
  'export clase': 'export class A { }',
  'export nombres': 'export { a, b as c };',
  'export nombres desde': 'export { a, b as c } from "modulo";',
  'export todo': 'export * from "modulo";',
  'export todo como': 'export * as util from "modulo";',
  'export default expresión': 'export default 5;',
  'export default función': 'export default func f() { }',
  'export default clase': 'export default class A { }',
  'módulo completo': `
    import { sumar, restar as menos } from "matematicas";
    import * as util from "utilidades";
    export const VERSION = "1.0";
    export func doble(int n) -> int { return n * 2; }
    export { sumar, menos as resta };
    export default doble;
  `,
  'programa completo': `
    // Programa de ejemplo
    int edad = 20;
    float pi = 3.14;
    string nombre = "Ana";
    func area(float r) -> float { return pi * r ** 2; }
    for (int i = 0; i < 3; i++) {
      if (i % 2 == 0 && edad >= 18) { print("par", i); } else { print(i); }
    }
    while (edad < 25) edad += 1;
    print(area(2.5));
  `,
};
Object.entries(validos).forEach(([nombre, src]) => {
  const r = run(src);
  check(!r.lexErrors.length, `[${nombre}] error léxico inesperado: ${JSON.stringify(r.lexErrors)}`);
  check(r.errors.length === 0 && r.ast && r.ast.type === 'Program',
    `[${nombre}] debería ser válido pero dio: ${JSON.stringify(r.errors)}`);
});
console.log(`Programas válidos: ${Object.keys(validos).length} casos`);

// ---------------------------------------------------------------
// 2) Forma del árbol: precedencia y asociatividad
// ---------------------------------------------------------------
const formas = [
  ['1 + 2 * 3', '(+ 1 (* 2 3))'],
  ['(1 + 2) * 3', '(* (+ 1 2) 3)'],
  ['1 - 2 - 3', '(- (- 1 2) 3)'],
  ['2 ** 3 ** 2', '(** 2 (** 3 2))'],
  ['-a ** 2', '(- (** a 2))'],
  ['a = b = c', '(= a (= b c))'],
  ['a += b * 2', '(+= a (* b 2))'],
  ['a || b && c', '(|| a (&& b c))'],
  ['a && b || c', '(|| (&& a b) c)'],
  ['a == b && c != d', '(&& (== a b) (!= c d))'],
  ['a < b == c > d', '(== (< a b) (> c d))'],
  ['a | b ^ c & d', '(| a (^ b (& c d)))'],
  ['a << 1 + 2', '(<< a (+ 1 2))'],
  ['a ?? b || c', '(?? a (|| b c))'],
  ['a ? b : c ? d : e', '(?: a b (?: c d e))'],
  ['a ? b = 1 : c', '(?: a (= b 1) c)'],
  ['!a && !b', '(&& (! a) (! b))'],
  ['- -a', '(- (- a))'],
  ['x++ + ++y', '(+ (++post x) (++pre y))'],
  ['f(1)(2)', '(call (call f 1) 2)'],
  ['a.b[c](d)', '(call (idx (. a b) c) d)'],
  ['a?.b?.[0]', '(idx? (.? a b) 0)'],
  ['new Foo(1, 2)', '(new Foo 1 2)'],
  ['typeof a == "x"', '(== (typeof a) "x")'],
  ['(a, b) => a + b', '(=> (a b) (+ a b))'],
  ['x => { }', '(=> (x) BLOCK)'],
  ['[1, [2], { a: 1 }]', '[1 [2] {a:1}]'],
  ['x = { a, b: 2 }', '(= x {a:a b:2})'],
  ['-1', '(- 1)'],
  ['1 + 2 * (3 - 4) / 5', '(+ 1 (/ (* 2 (- 3 4)) 5))'],
  ['a.b = c.d', '(= (. a b) (. c d))'],
  ['f(a, b + 1, [c])', '(call f a (+ b 1) [c])'],
  ['(a, b)', '(seq a b)'],
  ['x = (a, b)', '(= x (seq a b))'],
  ['(1, 2, 3)', '(seq 1 2 3)'],
  ['a = 1, b = 2', '(seq (= a 1) (= b 2))'],
  ['f((a, b), c)', '(call f (seq a b) c)'],
  ['a[i, j]', '(idx a (seq i j))'],
  ['(a, b) + 1', '(+ (seq a b) 1)'],
  ['x ? (a, b) : c', '(?: x (seq a b) c)'],
  ['(a, b) => a + b', '(=> (a b) (+ a b))'],
  ['[1, 2]', '[1 2]'],
];
formas.forEach(([src, esperado]) => {
  const got = expr(src);
  check(got === esperado, `forma de «${src}»: esperado ${esperado}, obtenido ${got}`);
});
console.log(`Formas del árbol (precedencia/asociatividad): ${formas.length} casos`);

// El paréntesis queda registrado en el nodo y amplía su ubicación
{
  const r = run('x = (1 + 2) * 3;');
  const mul = r.ast.body[0].expression.right;
  check(mul.operator === '*' && mul.left.parenthesized === true && mul.left.loc.column === 5 && mul.left.loc.endColumn === 12,
    'paréntesis: bandera y ubicación incluyen los paréntesis');
  check(mul.loc.column === 5, 'paréntesis: el nodo padre empieza en el paréntesis');
}

// Estructura de instrucciones
{
  const r = run('int a = 1, b; const int N = 2; let x = 3;');
  const [d1, d2, d3] = r.ast.body;
  check(d1.type === 'VariableDeclaration' && d1.kind === 'typed' && d1.dataType === 'int' && d1.declarations.length === 2
    && d1.declarations[0].id.name === 'a' && d1.declarations[1].init === null, 'VariableDeclaration tipada');
  check(d2.kind === 'const' && d2.dataType === 'int', 'const con tipo');
  check(d3.kind === 'let' && d3.dataType === null, 'let sin tipo');

  const f = run('func suma(int a, b = 2, ...r) -> float { return a; }').ast.body[0];
  check(f.type === 'FunctionDeclaration' && f.id.name === 'suma' && f.returnType === 'float' && f.params.length === 3
    && f.params[0].dataType === 'int' && f.params[1].defaultValue.raw === '2' && f.params[2].rest === true
    && f.body.body[0].type === 'ReturnStatement', 'FunctionDeclaration');

  const c = run('int doble(int n) { return n; }').ast.body[0];
  check(c.type === 'FunctionDeclaration' && c.returnType === 'int', 'función estilo C');

  const i = run('if (a) b = 1; else if (c) d = 2; else e = 3;').ast.body[0];
  check(i.type === 'IfStatement' && i.alternate.type === 'IfStatement' && i.alternate.alternate.type === 'ExpressionStatement', 'else if anidado');

  const fr = run('for (int i = 0; i < 3; i++) x;').ast.body[0];
  check(fr.type === 'ForStatement' && fr.init.type === 'VariableDeclaration' && sx(fr.test) === '(< i 3)' && sx(fr.update) === '(++post i)', 'ForStatement');
  check(run('for (;;) x;').ast.body[0].test === null, 'for sin condición');
  check(run('for (let x of a) y;').ast.body[0].type === 'ForOfStatement', 'ForOfStatement');
  check(run('for (k in o) y;').ast.body[0].type === 'ForInStatement', 'ForInStatement');
  check(sx(run('for (i = 0, j = 1; i < 2; i++, j--) x;').ast.body[0].init) === '(seq (= i 0) (= j 1))', 'for con secuencia');

  const sw = run('switch (x) { case 1: a; b; case 2: default: c; }').ast.body[0];
  check(sw.cases.length === 3 && sw.cases[0].consequent.length === 2 && sw.cases[1].consequent.length === 0 && sw.cases[2].test === null, 'SwitchStatement');

  const p = run('print(a, 1);').ast.body[0];
  check(p.type === 'PrintStatement' && p.arguments.length === 2, 'print con paréntesis');
  const p2 = run('print (a + b) * 2;').ast.body[0];
  check(p2.arguments.length === 1 && sx(p2.arguments[0]) === '(* (+ a b) 2)', 'print (a+b)*2 se interpreta como expresión');

  const t = run('try { a; } catch (e) { b; } finally { c; }').ast.body[0];
  check(t.handler.param.name === 'e' && t.finalizer.type === 'BlockStatement', 'TryStatement');

  const k = run('class A extends B { int x = 1; get() { return 1; } }').ast.body[0];
  check(k.superClass.name === 'B' && k.body[0].type === 'FieldDefinition' && k.body[1].type === 'MethodDefinition', 'ClassDeclaration');

  const dw = run('do x++; while (x < 3);').ast.body[0];
  check(dw.type === 'DoWhileStatement' && dw.body.type === 'ExpressionStatement', 'DoWhileStatement');
}

// Coma: marca de paréntesis y ubicación
{
  const r = run('x = (a, b);');
  const seq = r.ast.body[0].expression.right;
  check(seq.type === 'SequenceExpression' && seq.expressions.length === 2 && seq.parenthesized === true
    && seq.loc.column === 5 && seq.loc.endColumn === 11, `SequenceExpression entre paréntesis: ${JSON.stringify(seq.loc)}`);
  check(run('f(a, b);').ast.body[0].expression.arguments.length === 2, 'la coma de los argumentos sigue separando argumentos');
  check(run('int a = 1, b = 2;').ast.body[0].declarations.length === 2, 'la coma de las declaraciones sigue separando variables');
  check(run('print a, b;').ast.body[0].arguments.length === 2, 'la coma de print sigue separando valores');
}

// Módulos
{
  const imp = run('import x, { a, b as c } from "mod";').ast.body[0];
  check(imp.type === 'ImportDeclaration' && imp.source.value === 'mod' && imp.specifiers.length === 3
    && imp.specifiers[0].type === 'ImportDefaultSpecifier' && imp.specifiers[0].local.name === 'x'
    && imp.specifiers[1].type === 'ImportSpecifier' && imp.specifiers[1].imported.name === 'a' && imp.specifiers[1].local.name === 'a'
    && imp.specifiers[2].imported.name === 'b' && imp.specifiers[2].local.name === 'c', 'ImportDeclaration con por defecto y nombres');
  const ns = run('import * as u from "m";').ast.body[0];
  check(ns.specifiers.length === 1 && ns.specifiers[0].type === 'ImportNamespaceSpecifier' && ns.specifiers[0].local.name === 'u', 'import * as');
  check(run('import "m";').ast.body[0].specifiers.length === 0, 'import de efecto: sin nombres');

  const e1 = run('export int x = 5;').ast.body[0];
  check(e1.type === 'ExportNamedDeclaration' && e1.declaration.type === 'VariableDeclaration' && e1.source === null, 'export de declaración');
  const e2 = run('export { a, b as c } from "m";').ast.body[0];
  check(e2.declaration === null && e2.specifiers.length === 2 && e2.specifiers[1].local.name === 'b' && e2.specifiers[1].exported.name === 'c'
    && e2.source.value === 'm', 'export de nombres con origen');
  const e3 = run('export * as u from "m";').ast.body[0];
  check(e3.type === 'ExportAllDeclaration' && e3.exported.name === 'u' && e3.source.value === 'm', 'export * as');
  const e4 = run('export default func f() { }').ast.body[0];
  check(e4.type === 'ExportDefaultDeclaration' && e4.declaration.type === 'FunctionDeclaration', 'export default de función');
  const e5 = run('export default 1 + 2;').ast.body[0];
  check(e5.declaration.type === 'BinaryExpression', 'export default de expresión');
}

// Las ubicaciones (loc) apuntan al texto correcto
{
  const src = 'int x = 5;\nif (x > 3) {\n  x = 10;\n}';
  const r = run(src);
  const ifs = r.ast.body[1];
  check(ifs.loc.line === 2 && ifs.loc.column === 1 && ifs.loc.endLine === 4 && ifs.loc.endColumn === 2, `loc del if: ${JSON.stringify(ifs.loc)}`);
  const asg = ifs.consequent.body[0].expression;
  check(asg.loc.line === 3 && asg.loc.column === 3 && asg.loc.endColumn === 9, `loc de la asignación: ${JSON.stringify(asg.loc)}`);
}

// ---------------------------------------------------------------
// 3) Errores: mensaje, posición y recuperación
// ---------------------------------------------------------------
const malos = [
  // [nombre, código, nº de errores, línea, columna, fragmento del mensaje]
  ['falta ; al final', 'int x = 5', 1, 1, 10, "Falta ';'"],
  ['falta ; con más código después', 'int x = 5\nint y = 6;', 1, 1, 10, "Falta ';'"],
  ['falta ; en la misma línea', 'x = 5 y = 6;', 1, 1, 7, "Se esperaba ';'"],
  ['falta ) del if', 'if (x > 3 { y = 1; }', 1, 1, 10, "Falta ')'"],
  ['falta ( del if', 'if x > 3 { }', 1, 1, 4, "Se esperaba '('"],
  ['expresión vacía', 'x = ;', 1, 1, 5, 'Se esperaba una expresión después de'],
  ['operador sin operando', 'x = 5 + * 3;', 1, 1, 9, "después de '+'"],
  ['palabra reservada como nombre', 'int if = 5;', 1, 1, 5, 'palabra reservada'],
  ['tipo como nombre', 'int int = 5;', 1, 1, 5, 'palabra reservada'],
  ['falta nombre de variable', 'int = 5;', 1, 1, 5, 'nombre de la variable'],
  ['bloque sin cerrar', 'while (true) {\n  x = 1;\n', 1, 2, 9, "Falta '}'"],
  ['llave sin abrir', '}', 1, 1, 1, "sin su '{'"],
  ['else suelto', 'else { x = 1; }', 1, 1, 1, "'else' sin un 'if'"],
  ['case fuera de switch', 'case 1: x = 1;', 1, 1, 1, "dentro de un 'switch'"],
  ['catch suelto', 'catch (e) { }', 1, 1, 1, "después de un bloque 'try'"],
  ['for sin ;', 'for (int i = 0; i < 10 i++) {}', 1, 1, 24, "cabecera del 'for'"],
  ['asignar a un literal', '3 = x;', 1, 1, 1, 'No se puede asignar'],
  ['asignar a una operación', 'a + b = 3;', 1, 1, 1, 'No se puede asignar'],
  ['incrementar un literal', '5++;', 1, 1, 1, 'solo se puede aplicar a una variable'],
  ['función sin nombre', 'func (a) { }', 1, 1, 6, 'nombre de la función'],
  ['paréntesis sin cerrar', 'x = (1 + 2;', 1, 1, 11, "Falta ')'"],
  ['paréntesis sin cerrar (otra línea)', 'x = (1 + 2\ny = 3;', 1, 1, 11, "abierto en la línea 1"],
  ['print con error', 'print(a b);', 1, 1, 8, "Falta ')'"],
  ['corchete sin cerrar', 'x = [1, 2;', 1, 1, 10, "Falta ']'"],
  ['ternario sin :', 'x = a ? b;', 1, 1, 10, "operador ternario"],
  ['símbolo suelto', '@x = 1;', 1, 1, 1, "El símbolo '@'"],
  ['símbolo en medio', 'x = 5 @ 3;', 1, 1, 7, "Se esperaba ';'"],
  ['import sin from', 'import x;', 1, 1, 9, "Se esperaba 'from'"],
  ['import sin nombre', 'import from "m";', 1, 1, 8, 'Falta indicar qué se importa'],
  ['import con coma faltante', 'import { a b } from "m";', 1, 1, 11, "Falta ','"],
  ['import sin from (llaves)', 'import { a } "m";', 1, 1, 14, "Se esperaba 'from'"],
  ['import módulo sin comillas', 'import x from m;', 1, 1, 15, 'entre comillas'],
  ['import * sin as', 'import * from "m";', 1, 1, 10, "Se esperaba 'as'"],
  ['import sin ;', 'import x from "m"\nint y = 1;', 1, 1, 18, "Falta ';'"],
  ['import con llave sin cerrar', 'import { a from "m";', 1, 1, 11, "Falta '}'"],
  ['export vacío', 'export;', 1, 1, 7, 'una declaración'],
  ['export de una expresión', 'export 5;', 1, 1, 8, 'una declaración'],
  ['export default vacío', 'export default;', 1, 1, 15, 'Se esperaba una expresión'],
  ['export * sin from', 'export * "m";', 1, 1, 10, "Se esperaba 'from'"],
  ['export nombres sin cerrar', 'export { a, b ;', 1, 1, 14, "Falta '}'"],
  ['import dentro de función', 'func f() { import x from "m"; }', 1, 1, 12, 'nivel principal'],
  ['export dentro de if', 'if (a) export int x = 1;', 1, 1, 8, 'nivel principal'],
  ['export dentro de bloque', '{ export int x = 1; }', 1, 1, 3, 'nivel principal'],
  ['coma sin segundo valor', 'x = (a, );', 1, 1, 9, "después de ','"],
  ['coma doble', 'x = (a,, b);', 1, 1, 8, "después de ','"],
  ['if sin cuerpo', 'if (x)', 1, 1, 7, "Falta el cuerpo del 'if'"],
  ['do sin while', 'do { } x = 1;', 1, 1, 8, "'while'"],
  ['switch con basura', 'switch (x) { y = 1; case 1: z; }', 1, 1, 14, "solo puede haber 'case' o 'default'"],
  ['try sin catch', 'try { }', 1, 1, 8, "'catch' o 'finally'"],
  ['coma de más en declaración', 'int a = 1, ;', 1, 1, 12, 'nombre de la variable'],
  ['punto sin nombre', 'x = a.;', 1, 1, 7, 'nombre de una propiedad'],
  ['objeto sin :', 'x = { a 1 };', 1, 1, 9, "':'"],
];
malos.forEach(([nombre, src, n, line, col, frag]) => {
  const r = run(src);
  const e = r.errors[0];
  const ok = !r.lexErrors.length && r.errors.length === n && e && e.line === line && e.column === col && e.message.includes(frag);
  check(ok, `[${nombre}] «${src.replace(/\n/g, '\\n')}» -> ${r.lexErrors.length ? 'LÉXICO ' + JSON.stringify(r.lexErrors) : JSON.stringify(r.errors)} (esperado ${n} error en ${line}:${col} con «${frag}»)`);
});
console.log(`Errores con posición y mensaje: ${malos.length} casos`);

// Falta una coma entre parámetros: un solo error y la función se conserva con sus 2 parámetros
{
  const r = run('func suma(int a int b) -> int { return a + b; }\nx = 1;');
  check(r.errors.length === 1 && r.errors[0].column === 16 && r.errors[0].message.includes("Falta ','"), `coma entre parámetros: ${JSON.stringify(r.errors)}`);
  check(r.ast.body.length === 2 && r.ast.body[0].params.length === 2, 'coma entre parámetros: se conserva la función');
}

// Recuperación: sigue leyendo y reporta varios errores a la vez
{
  const r = run('int a = ;\nint b = 2;\nif (b > ) { }\nint c = 3 +;\nprint(b);');
  check(r.errors.length === 3, `recuperación: esperados 3 errores, hubo ${r.errors.length}: ${JSON.stringify(r.errors)}`);
  check(JSON.stringify(r.errors.map((e) => e.line)) === '[1,3,4]', 'recuperación: errores en las líneas 1, 3 y 4');
  const tipos = r.ast.body.map((s) => s.type);
  check(tipos.includes('VariableDeclaration') && tipos.includes('PrintStatement'), `recuperación: se conservan las instrucciones correctas (${tipos})`);
}
{
  // Un error dentro de un bloque no destruye el resto del bloque ni del programa
  const r = run('func f() {\n  x = ;\n  y = 2;\n}\nz = 3;');
  check(r.errors.length === 1 && r.errors[0].line === 2, 'error dentro de función: 1 error en línea 2');
  const fn = r.ast.body[0];
  check(fn.type === 'FunctionDeclaration' && fn.body.body.length === 1 && r.ast.body.length === 2, 'se conserva el resto de la función y del programa');
}
{
  // Recuperación suave: falta ')' pero el cuerpo se sigue analizando
  const r = run('if (x > 3 { y = 1; }\nz = 2;');
  check(r.errors.length === 1 && r.ast.body[0].type === 'IfStatement' && r.ast.body[0].consequent.type === 'BlockStatement' && r.ast.body.length === 2,
    'recuperación suave de ")" faltante');
}
{
  // Un error en un encabezado salta todo el bloque sin errores en cascada
  const r = run('if (x > ) {\n  a = 1;\n  b = 2;\n}\nc = 3;');
  check(r.errors.length === 1, `error en cabecera: sin cascada (${JSON.stringify(r.errors)})`);
  check(r.ast.body.length === 1 && sx(r.ast.body[0].expression) === '(= c 3)', 'tras el error se retoma en la instrucción siguiente');
}
{
  // Errores con la misma posición no se repiten
  const r = run('x = = = ;');
  check(r.errors.length >= 1 && r.errors.every((e, i, a) => i === 0 || !(e.line === a[i - 1].line && e.column === a[i - 1].column)), 'sin errores duplicados');
}

// ---------------------------------------------------------------
// 4) Robustez: nunca se cuelga ni lanza excepciones (prueba aleatoria)
// ---------------------------------------------------------------
{
  const piezas = ['int', 'float', 'x', 'y', '5', '3.14', '"s"', '=', '==', '+', '-', '*', '**', '/', '%', '(', ')', '{', '}', '[', ']',
    ';', ',', '.', '?', ':', '?.', '=>', '->', '...', '++', '--', '!', '&&', '||', '??', '<', '>', '<=', '+=', '@', '#',
    'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'print', 'func',
    'function', 'let', 'const', 'var', 'true', 'null', 'new', 'this', 'try', 'catch', 'finally', 'throw', 'class',
    'extends', 'of', 'in', 'typeof', 'import', 'export', 'from', 'as', '*', 'void', 'bool'];
  let semilla = 12345;
  const rnd = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
  let maxMs = 0;
  let excepciones = 0;
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const largo = 1 + Math.floor(rnd() * 40);
    let src = '';
    for (let j = 0; j < largo; j++) src += piezas[Math.floor(rnd() * piezas.length)] + (rnd() < 0.15 ? '\n' : ' ');
    const lex = new Lexer(src).tokenize();
    if (lex.errors.length) continue;
    const t0 = Date.now();
    try {
      const r = parse(lex.tokens);
      const okForma = r.ast.type === 'Program'
        && r.errors.every((e) => e.line >= 1 && e.column >= 1 && e.length >= 1 && typeof e.message === 'string');
      if (!okForma) { excepciones++; console.log('FORMA INVÁLIDA:', JSON.stringify(src)); }
    } catch (e) {
      excepciones++;
      if (excepciones < 4) console.log('EXCEPCIÓN:', e.message, JSON.stringify(src));
    }
    maxMs = Math.max(maxMs, Date.now() - t0);
  }
  check(excepciones === 0, `${excepciones} programas aleatorios provocaron excepción o forma inválida`);
  check(maxMs < 200, `un análisis tardó ${maxMs} ms`);
  console.log(`Prueba aleatoria: ${N} programas, 0 excepciones, el más lento tardó ${maxMs} ms`);

  // Anidamiento extremo: no debe reventar la pila
  const profundos = ['('.repeat(5000) + '1' + ')'.repeat(5000), '{'.repeat(5000), '['.repeat(5000), 'if (a) '.repeat(3000) + 'x;', '-'.repeat(8000) + 'x;'];
  profundos.forEach((src, i) => {
    let ok = true;
    try { const lex = new Lexer(src).tokenize(); const r = parse(lex.tokens); ok = r.ast.type === 'Program' && r.errors.length >= 1; } catch (e) { ok = false; }
    check(ok, `anidamiento extremo #${i + 1} debería terminar con errores controlados`);
  });
  console.log(`Anidamiento extremo: ${profundos.length} casos controlados`);
}

console.log(`\n${total - fallos} de ${total} comprobaciones correctas`);
console.log(fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${fallos} PRUEBA(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
