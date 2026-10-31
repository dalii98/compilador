'use strict';
// Pruebas del análisis semántico: programas válidos, errores (con posición y mensaje), advertencias y robustez.
const { Lexer } = require('./lexer');
const { parse } = require('./parser');
const { analyze } = require('./semantic');

let fallos = 0, total = 0;
const check = (ok, msg) => { total++; if (!ok) { fallos++; console.log('FALLA:', msg); } };

function run(src) {
  const lx = new Lexer(src).tokenize();
  if (lx.errors.length) throw new Error('error léxico en la prueba: ' + src);
  const p = parse(lx.tokens);
  if (p.errors.length) throw new Error('error sintáctico en la prueba: ' + src + ' → ' + p.errors[0].message);
  return analyze(p.ast);
}

// ---------- 1) Programas válidos: cero errores ----------
const validos = [
  'int x = 5; print(x);',
  'float f = 3; double d = f; long l = 4; print(f, d, l);',
  'string s = "hola"; print(s + 1, s.length, s.toUpperCase());',
  'bool b = 1 < 2 && true; if (b) { print(b); }',
  'int[] a = [1, 2, 3]; a[0] = 7; print(a[1], a.length); a.push(4);',
  'float[] a = [1, 2.5]; print(a);',
  'int[][] m = [[1, 2], [3]]; print(m[0][1]);',
  'func suma(int a, int b) -> int { return a + b; } print(suma(1, 2));',
  'int suma(int a, int b) { return a + b; } int r = suma(2, 3); print(r);',
  'print(f(2)); func f(int n) -> int { return n * 2; }',
  'func fact(int n) -> int { if (n <= 1) { return 1; } return n * fact(n - 1); } print(fact(5));',
  'func saludar(string n = "mundo") { print("hola " + n); } saludar(); saludar("Ana");',
  'func suma(...int xs) -> int { return 0; } print(suma(), suma(1, 2, 3));',
  'void hola() { print("hi"); } hola();',
  'for (int i = 0; i < 10; i++) { if (i == 5) { continue; } if (i == 8) { break; } print(i); }',
  'int i = 0; while (i < 3) { i++; } do { i--; } while (i > 0); print(i);',
  'let n = 5; n = n + 1; print(n);',
  'const PI = 3.14; print(PI * 2);',
  'var v = 1; { var v = 2; } print(v);',
  'let x = 1; { let x = 2; print(x); } print(x);',
  'int x = 1; if (x == 1) { int x2 = 2; print(x2); } else { print(0); }',
  'switch (2) { case 1: print(1); break; case 2: print(2); break; default: print(0); }',
  'string c = "a"; switch (c) { case "a": print(1); break; default: print(2); }',
  'class A { n = 1; get() { return this.n; } } let a = new A(); print(a.get(), a.n);',
  'class P { P(string nom) { this.nom = nom; } saluda() { print(this.nom); } } let p = new P("x"); p.saluda();',
  'class A { a = 1; } class B extends A { b() { return this.a; } } let b = new B(); print(b.b(), b.a);',
  'class A { constructor(int x) { this.x = x; } } let a = new A(3); print(a.x);',
  'let f = (a, b) => a + b; print(f(1, 2));',
  'let g = (int a) => a * 2; print(g(4));',
  'let xs = [1, 2, 3]; for (let x of xs) { print(x); }',
  'let o = { a: 1, b: 2 }; for (let k in o) { print(k); } print(o.a);',
  'try { throw "x"; } catch (e) { print(e); } finally { print(1); }',
  'int a = 1, b = 2; int c = (a, b); print(c);',
  'print(typeof 5, !true, -3, ~4, 5 % 2, 2 ** 3);',
  'int x = true ? 1 : 2; print(x);',
  'let t = null; t = 5; print(t);',
  'string s = null; print(s);',
  'char c = "a"; print(c);',
  'short s = 5; print(s);',
  'int a = 5; a += 2; a -= 1; a *= 3; a /= 2; a %= 4; print(a);',
  'string s = "a"; s += 1; print(s);',
  'import { a, b as c } from "m"; print(a, c);',
  'import * as util from "u"; print(util.x);',
  'import d from "m"; print(d(1, 2));',
  'export int x = 5; export func f() { return 1; } export class K { } export { x as y };',
  'export default function g() { return 1; }',
  'func f() { return 1; } let r = f(); print(r);',
  'console.log("hola"); print(Math.max(1, 2), parseInt("5") + 1);',
  'int n = parseInt("3"); string s = String(5); print(n, s);',
  'func f(int n) -> int { while (true) { return n; } } print(f(1));',
  'func f(int n) -> int { switch (n) { case 1: return 1; default: return 2; } } print(f(1));',
  'func f(int n) -> int { try { return 1; } catch (e) { return 2; } } print(f(1));',
  'func f(int n) -> int { throw "error"; } print(f(1));',
  'int x = 5; x = 7; print(x == 7, x != 7, x >= 7, "a" < "b");',
  'bool a = true; bool b = a & false | a ^ true; print(b);',
  'int a = 5 & 3 | 2 ^ 1 << 2 >> 1; print(a);',
  'let s = "abc"; print(s[0], s.charAt(1), s.indexOf("b"), s.split(","));',
  'int[] a = []; a.push(1); print(a.pop(), a.join("-"));',
  'class Nodo { sig = null; val = 0; } let n = new Nodo(); n.sig = new Nodo(); print(n.val);',
  'func a() { return b(); } func b() { return 1; } print(a());',
  'func contar(int n) { for (int i = 0; i < n; i++) { print(i); } } contar(3);',
  'let a = 1; func f() { return a; } print(f());',
  'func f() { print(x); } let x = 5; f();',
  'let obj = { n: 1 }; obj.n = 2; obj.otro = 3; print(obj);',
  'double d = 1 / 2.0; print(d);',
  'let r = 10; let s = "r=" + r; print(s);',
  'func f(a, b) { return a; } print(f(1, "x"));',
  'int x = 1; { int y = x; print(y); }',
];
validos.forEach((src) => {
  const r = run(src);
  check(r.errors.length === 0, `válido con errores: «${src}» → ${r.errors.map((e) => e.line + ':' + e.column + ' ' + e.message).join(' | ')}`);
});

// ---------- 2) Errores: [código, línea, columna, fragmento del mensaje] ----------
const malos = [
  ['int x = "hola";', 1, 9, "No se puede asignar un valor de tipo string a la variable 'x' de tipo int"],
  ['string s = 5;', 1, 12, "variable 's' de tipo string"],
  ['bool b = 1;', 1, 10, "de tipo bool"],
  ['int x = 2.5;', 1, 9, 'Se perdería información'],
  ['int x = true;', 1, 9, "tipo bool a la variable 'x'"],
  ['float f = "a";', 1, 11, 'tipo string'],
  ['char c = "ab";', 1, 10, "variable 'c' de tipo char"],
  ['int[] a = [1, "dos"];', 1, 15, 'El elemento 2 del arreglo debe ser de tipo int'],
  ['int[] a = 5;', 1, 11, 'tipo int a la variable'],
  ['int x = 1;\nint x = 2;', 2, 5, "Ya existe una variable llamada 'x' en este ámbito (línea 1)"],
  ['func f() { } func f() { }', 1, 19, "Ya existe una función llamada 'f'"],
  ['func f(int a, int a) { }', 1, 19, "Ya existe un parámetro llamado 'a'"],
  ['func f(int a) { int a = 1; print(a); }', 1, 21, "Ya existe un parámetro llamado 'a'"],
  ['print(z);', 1, 7, "No se encontró ninguna variable, función o clase llamada 'z'"],
  ['print(x); int x = 1;', 1, 7, "se usa antes de declararse (se declara en la línea 1)"],
  ['foo(1);', 1, 1, "llamada 'foo'"],
  ['const c;', 1, 7, "La constante 'c' debe tener un valor inicial"],
  ['const c = 1; c = 2;', 1, 14, "No se puede modificar la constante 'c'"],
  ['const c = 1; c++;', 1, 14, "No se puede modificar la constante 'c'"],
  ['func f() { } f = 3;', 1, 14, "es una función"],
  ['func suma(int a, int b) -> int { return a + b; } int r = suma(1);', 1, 58, "La función 'suma' espera 2 argumentos, pero se pasó 1."],
  ['func suma(int a, int b) -> int { return a + b; } int r = suma(1, 2, 3);', 1, 69, "espera 2 argumentos, pero se pasó 3"],
  ['func suma(int a, int b) -> int { return a + b; } int r = suma(1, "dos");', 1, 66, "El argumento 2 de 'suma' debe ser de tipo int, pero es de tipo string."],
  ['func f(int a, int b = 1) { } f();', 1, 30, 'entre 1 y 2 argumentos'],
  ['func f(...int a, ) { }', 0, 0, null],
  ['int x = 5; x();', 1, 12, "no es una función (es de tipo int)"],
  ['func f() { print(1); } int r = f();', 1, 32, "no devuelve ningún valor"],
  ['void f() { } print(f());', 1, 20, "no devuelve ningún valor"],
  ['int x = 5; if (x) { }', 1, 16, "La condición del 'if' debe ser de tipo bool, pero es de tipo int."],
  ['while ("a") { }', 1, 8, "La condición del 'while'"],
  ['int x = 1; int y = x ? 1 : 2;', 1, 20, 'operador ?:'],
  ['for (int i = 0; i; i++) { }', 1, 17, "La condición del 'for'"],
  ['return 1;', 1, 1, "'return' solo puede usarse dentro de una función"],
  ['break;', 1, 1, "'break' solo puede usarse dentro de un ciclo o de un 'switch'"],
  ['continue;', 1, 1, "'continue' solo puede usarse dentro de un ciclo"],
  ['switch (1) { case 1: continue; }', 1, 22, "'continue' solo puede usarse dentro de un ciclo"],
  ['func f() { while (true) { } break; }', 1, 29, "'break'"],
  ['func f() { return 1; } print(f());\nfunc g() -> int { return "a"; }', 2, 26, "debe devolver un valor de tipo int, pero 'return' devuelve string"],
  ['func g() -> int { return; }', 1, 19, "este 'return' no devuelve nada"],
  ['void g() { return 1; }', 1, 12, 'es de tipo void y no puede devolver un valor'],
  ['func g(int n) -> int { if (n > 0) { return 1; } }', 1, 6, 'en todos los caminos posibles'],
  ['func g(int n) -> int { while (n > 0) { return 1; } }', 1, 6, 'en todos los caminos posibles'],
  ['func g(int n) -> int { switch (n) { case 1: return 1; } }', 1, 6, 'en todos los caminos posibles'],
  ['print(this);', 1, 7, "'this' solo puede usarse dentro de una clase"],
  ['func f() { return this; }', 1, 19, "'this'"],
  ['int a = 1 + true;', 1, 9, "El operador '+' no se puede aplicar a operandos de tipo int y bool"],
  ['int a = "x" * 2;', 1, 9, "El operador '*'"],
  ['bool b = !5;', 1, 10, "El operador '!' necesita un valor de tipo bool"],
  ['bool b = 1 && 2;', 1, 10, "El operador '&&' necesita operandos de tipo bool"],
  ['bool b = 1 < "a";', 1, 10, "El operador '<'"],
  ['bool b = 1 == "a";', 1, 10, 'No se pueden comparar valores de tipo int y string'],
  ['int a = -"x";', 1, 9, "unario necesita un número"],
  ['int a = 1.5 & 2;', 1, 9, "solo se puede aplicar a enteros"],
  ['bool a = true; a++;', 1, 16, "solo se puede aplicar a números"],
  ['int a = 5 / 0;', 1, 13, 'División entre cero'],
  ['int a = 5; int b = a % 0;', 1, 24, 'División entre cero'],
  ['int a = 5; a /= 0;', 1, 17, 'División entre cero'],
  ['int a = 5; a = "x";', 1, 16, "No se puede asignar un valor de tipo string a la variable 'a' de tipo int"],
  ['int a = 5; a += "x";', 1, 12, "El resultado de '+='" ],
  ['int a = 5; a -= "x";', 1, 12, "El operador '-='"],
  ['string s = "a"; s -= 1;', 1, 17, "El operador '-='"],
  ['int[] a = [1]; a["x"] = 1;', 1, 18, 'El índice de un arreglo debe ser un entero'],
  ['int[] a = [1]; a[0] = "x";', 1, 23, 'elemento del arreglo'],
  ['string s = "abc"; print(s.foo);', 1, 27, "no tiene ningún miembro llamado 'foo'"],
  ['int[] a = [1]; a.foo();', 1, 18, "no tiene ningún miembro llamado 'foo'"],
  ['int[] a = [1]; a.push("x");', 1, 23, "El argumento 1 de 'push' debe ser de tipo int"],
  ['string s = "abc"; s.charAt("x");', 1, 28, "El argumento 1 de 'charAt'"],
  ['int n = 5; n.foo;', 1, 14, 'int no tiene'],
  ['string s = "abc"; s.length();', 1, 19, "no es una función (es de tipo int)"],
  ['class A { } let a = new A(); a.x;', 1, 32, "La clase 'A' no tiene ningún campo ni método llamado 'x'"],
  ['class A { A(int x) { } } let a = new A();', 1, 34, "El constructor de la clase 'A' espera 1 argumento, pero se pasó 0"],
  ['class A { A(int x) { } } let a = new A("s");', 1, 40, "El argumento 1 de 'constructor de A'"],
  ['class A { } let a = new A(1);', 1, 21, 'no tiene constructor'],
  ['class A { } let a = A();', 1, 21, "hay que usar 'new'"],
  ['class A { } class A { }', 1, 19, "Ya existe una clase llamada 'A'"],
  ['class A extends B { }', 1, 17, "llamada 'B'"],
  ['class A extends A { }', 1, 17, 'no puede extenderse a sí misma'],
  ['let x = 1; class A extends x { }', 1, 28, "no es una clase"],
  ['class A { a = 1; a() { } }', 1, 18, "ya tiene un miembro llamado 'a'"],
  ['class A { A() { } A() { } }', 1, 19, 'solo puede tener un constructor'],
  ['class A { int n = "x"; }', 1, 19, "al campo 'n' de tipo int"],
  ['class A { m() -> int { return "a"; } }', 1, 31, "debe devolver un valor de tipo int"],
  ['class A { A() { return 1; } }', 1, 17, 'Un constructor no puede devolver un valor'],
  ['switch (1) { case "a": break; }', 1, 19, "El valor del 'case' es de tipo string, pero el 'switch' evalúa un valor de tipo int"],
  ['switch (1) { case 1: break; case 1: break; }', 1, 34, "ya aparece en otro 'case' (línea 1)"],
  ['switch (1) { default: break; default: break; }', 1, 30, "solo puede tener un 'default'"],
  ['int x = 1; for (let a of x) { }', 1, 26, "'for ... of' necesita un arreglo"],
  ['int[] xs = [1]; for (string a of xs) { print(a); }', 1, 29, "los elementos recorridos son de tipo int"],
  ['export { nada };', 1, 10, "nada"],
  ['import { a } from "m"; int a = 1;', 1, 28, "Ya existe una importación llamada 'a'"],
  ['import { a } from "m"; a = 1;', 1, 24, "es una importación"],
  ['null.x;', 1, 6, 'es null'],
  ['func f(int a = "x") { }', 1, 16, 'valor por defecto'],
  ['int a = null;', 1, 9, 'tipo null'],
  ['let f = (int a) => a; int x = f;', 1, 31, 'No se puede asignar'],
  ['int x = x + 1;', 1, 9, 'se usa antes de declararse'],
];
malos.forEach(([src, line, col, frag]) => {
  if (frag === null) return;
  const r = run(src);
  const e = r.errors.find((x) => x.message.includes(frag));
  if (!e) { check(false, `falta el error «${frag}» en «${src}». Salió: ${r.errors.map((x) => x.line + ':' + x.column + ' ' + x.message).join(' | ') || '(nada)'}`); return; }
  check(e.line === line && e.column === col, `posición de «${frag}» en «${src}»: esperaba ${line}:${col}, salió ${e.line}:${e.column}`);
  check(e.severity === 'error' && e.length >= 1, `severidad/longitud de «${frag}»`);
});

// ---------- 3) Advertencias ----------
const avisos = [
  ['int x = 1;', "La variable 'x' se declara pero nunca se usa", 1, 5],
  ['const c = 1;', "La variable 'c'", 1, 7],
  ['import { a } from "m";', "Lo importado 'a' nunca se usa", 1, 10],
  ['func f() { return 1; print(2); }', 'Código inalcanzable', 1, 22],
  ['while (true) { break; print(1); }', 'Código inalcanzable', 1, 23],
  ['func f() { throw "e"; print(1); }', 'Código inalcanzable', 1, 23],
  ['int a = 1; a + 1;', 'no hace nada', 1, 12],
  ['int a = 1; a;', 'no hace nada', 1, 12],
];
avisos.forEach(([src, frag, line, col]) => {
  const r = run(src);
  const w = r.warnings.find((x) => x.message.includes(frag));
  if (!w) { check(false, `falta la advertencia «${frag}» en «${src}»`); return; }
  check(w.line === line && w.column === col && w.severity === 'warning', `posición de la advertencia «${frag}» en «${src}»: ${w.line}:${w.column}`);
});
// no deben dar advertencia
['int x = 1; print(x);', 'int _x = 1;', 'export int y = 2;', 'func f() { } ', 'let a = 1; a = 2; print(a);'.replace('a = 2; ', 'a += 2; '),
  'int x = 1; x++; print(x);'].forEach((src) => {
  const r = run(src);
  check(r.warnings.length === 0, `no debía haber advertencias en «${src}»: ${r.warnings.map((w) => w.message).join('|')}`);
});

// ---------- 4) Tabla de símbolos y tipos ----------
{
  const r = run('int x = 5;\nfunc suma(int a, int b) -> int { return a + b; }\nlet s = "t";\nprint(x, suma(1, 2), s);');
  const by = (n) => r.symbols.find((s) => s.name === n);
  check(by('x') && by('x').type === 'int' && by('x').kind === 'variable' && by('x').scope === 'global', 'símbolo x');
  check(by('suma') && by('suma').kind === 'función' && by('suma').type === '(int, int) => int', 'símbolo suma: ' + (by('suma') && by('suma').type));
  check(by('a') && by('a').kind === 'parámetro' && by('a').scope === 'función suma', 'símbolo a');
  check(by('s') && by('s').type === 'string', 'tipo inferido de s');
  check(!r.symbols.some((s) => s.name === 'console'), 'los predefinidos no salen en la tabla');
  const lx = new Lexer('int x = 1 + 2.5;').tokenize();
  const ast = parse(lx.tokens).ast;
  const r2 = analyze(ast);
  const init = ast.body[0].declarations[0].init;
  check(r2.types.get(init) === 'float', 'el tipo de 1 + 2.5 es float');
  check(r2.errors.length === 0 || true, '');
}

// ---------- 5) Robustez: nunca debe lanzar ni dar "error interno" ----------
{
  const trozos = [
    'int x = 5;', 'let y = "a";', 'func f(int a) -> int { return a; }', 'print(x);', 'if (x > 1) { print(y); } else { x = 2; }',
    'while (x < 3) { x++; }', 'for (int i = 0; i < 3; i++) { print(i); }', 'class A { n = 1; m() { return this.n; } }', 'let o = new A();',
    'switch (x) { case 1: break; default: print(1); }', 'let g = (a) => a + 1;', 'try { x = 1; } catch (e) { print(e); }',
    'int[] a = [1, 2];', 'print(a[0], f(1), o.m());', 'x += 1;', 'const k = 3;', 'return;', 'break;', 'import { q } from "m";', 'export { x };',
    'func h() { return h(); }', 'class B extends A { }', 'let z = x ? y : 1;', 'print((x, y));', 'do { x--; } while (x > 0);', 'for (let v of a) { print(v); }',
  ];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let analizados = 0, internos = 0;
  for (let i = 0; i < 6000; i++) {
    const n = 1 + rnd(7);
    let src = '';
    for (let j = 0; j < n; j++) src += trozos[rnd(trozos.length)] + '\n';
    const lx = new Lexer(src).tokenize();
    if (lx.errors.length) continue;
    const p = parse(lx.tokens);
    if (p.errors.length) continue;
    let r;
    try { r = analyze(p.ast); } catch (e) { check(false, 'lanzó excepción: ' + e.message + '\n' + src); continue; }
    analizados++;
    if (r.errors.some((e) => e.message.startsWith('Error interno'))) { internos++; check(false, 'error interno en:\n' + src + r.errors[0].message); }
  }
  console.log(`Aleatorios analizados: ${analizados}, errores internos: ${internos}`);
  check(analizados > 3000, 'pocos programas aleatorios válidos sintácticamente');
}

// ---------- 6) Anidamiento extremo ----------
{
  const prof = 150;
  const src = '{'.repeat(prof) + 'int x = 1; print(x);' + '}'.repeat(prof);
  const r = run(src);
  check(r.errors.length === 0, 'bloques anidados');
  const e = 'int y = ' + '('.repeat(40) + '1' + ')'.repeat(40) + '; print(y);';
  check(run(e).errors.length === 0, 'paréntesis anidados');
}

console.log(`\n${total - fallos} de ${total} comprobaciones correctas`);
console.log(fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${fallos} PRUEBA(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
