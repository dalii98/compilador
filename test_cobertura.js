'use strict';
// Prueba de cobertura del léxico: ningún carácter "razonable" debe generar error léxico.
const { Lexer } = require('./lexer');

const lex = (s) => new Lexer(s).tokenize();
let fallos = 0;
const check = (ok, msg) => { if (!ok) { fallos++; console.log('FALLA:', msg); } };

// 1) Cada carácter ASCII imprimible, solo (las comillas sueltas SÍ deben dar "sin cerrar")
const comillas = new Set(['"', "'", '`']);
let sinError = 0;
for (let code = 33; code <= 126; code++) {
  const ch = String.fromCharCode(code);
  const { errors } = lex(ch);
  if (comillas.has(ch)) check(errors.length === 1, `comilla suelta ${ch} debería dar 1 error`);
  else { check(errors.length === 0, `carácter '${ch}' dio error: ${errors[0] && errors[0].message}`); sinError++; }
}
console.log(`ASCII imprimible sin error léxico: ${sinError} de ${126 - 33 + 1 - comillas.size} caracteres`);

// 2) Cada operador / delimitador / símbolo definido produce un token de una sola pieza
const { OPERATORS } = require('./lexer');
OPERATORS.forEach((tipo, op) => {
  const { tokens, errors } = lex(op);
  check(errors.length === 0 && tokens.length === 2 && tokens[0].lexeme === op && tokens[0].type === tipo,
    `operador '${op}' mal tokenizado`);
});
console.log(`Operadores/delimitadores/símbolos definidos: ${OPERATORS.size}, todos tokenizados correctamente`);

// 3) Letras y dígitos: todo el abecedario, mayúsculas, ñ, tildes, dígitos
const palabras = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ñandú', 'Año', 'canción', 'pingüino', 'ÁÉÍÓÚ', '_x', '$y', 'a1b2c3', 'x_1$'];
palabras.forEach((w) => {
  const { tokens, errors } = lex(w);
  check(errors.length === 0 && tokens[0].type === 'IDENTIFIER' && tokens[0].lexeme === w, `identificador '${w}'`);
});
for (let d = 0; d <= 9; d++) {
  const { tokens, errors } = lex(String(d));
  check(errors.length === 0 && tokens[0].type === 'INT' && tokens[0].value === d, `dígito ${d}`);
}

// 4) Formatos de número
const numeros = [
  ['0', 'INT', 0], ['007', 'INT', 7], ['123456', 'INT', 123456], ['1_000', 'INT', 1000],
  ['0xFF', 'INT', 255], ['0Xab', 'INT', 171], ['0b1010', 'INT', 10], ['0o17', 'INT', 15],
  ['3.14', 'FLOAT', 3.14], ['.5', 'FLOAT', 0.5], ['1e3', 'FLOAT', 1000], ['2.5E-3', 'FLOAT', 0.0025], ['1E+2', 'FLOAT', 100],
];
numeros.forEach(([src, tipo, val]) => {
  const { tokens, errors } = lex(src);
  check(errors.length === 0 && tokens[0].type === tipo && tokens[0].value === val, `número '${src}' -> ${JSON.stringify(tokens[0])} ${JSON.stringify(errors)}`);
});

// 5) Cadenas con las tres comillas y escapes
const cadenas = [['"hola"', 'hola'], ["'hola'", 'hola'], ['`hola`', 'hola'], ['"a\\nb"', 'a\nb'], ['"comilla \\" dentro"', 'comilla " dentro'],
  ["'it\\'s'", "it's"], ['"\\u00f1"', 'ñ'], ['"\\x41"', 'A'], ['""', ''], ['"@#$%^&*()"', '@#$%^&*()'], ['`línea1\nlínea2`', 'línea1\nlínea2']];
cadenas.forEach(([src, val]) => {
  const { tokens, errors } = lex(src);
  check(errors.length === 0 && tokens[0].type === 'STRING' && tokens[0].value === val, `cadena ${src}`);
});

// 6) Los errores reales SÍ se detectan
const malos = [['12abc', 'Número mal formado'], ['0x', 'Número mal formado'], ['0b12', 'Número mal formado'], ['"abc', 'sin cerrar'],
  ['/* hola', 'sin cerrar'], ['¿', 'no reconocido'], ['"\\q"', 'escape inválida']];
malos.forEach(([src, frag]) => {
  const { errors } = lex(src);
  check(errors.length >= 1 && errors[0].message.includes(frag), `debería dar error '${frag}' para ${src}`);
});

// 7) Programa de estrés con casi todo mezclado
const estres = `
// comentario de línea
/* comentario
   de varias líneas */
let a = 10, b = 0xFF, c = 3.5e-2, d = .5;
const nombre = 'Ana', saludo = "Hola, mundo", t = \`plantilla\`;
var arr = [1, 2, 3], obj = { x: 1, y: 2 };
a += 1; a -= 1; a *= 2; a /= 2; a %= 3; a **= 2; a &= 1; a |= 2; a ^= 3; a <<= 1; a >>= 1; a >>>= 1;
a++; --b;
if (a == b || a != b && a === b || !(a !== b)) { print(a <= b, a >= b, a < b, a > b); }
x = cond ? 1 : 2; y = u ?? v; z = o?.p; f = (q) => q + 1; g = ~a & b | c ^ d << 1 >> 2 >>> 3;
spread(...arr); @decorador #etiqueta \\ barra
func suma(int x, float y) -> int { return x + y * 2 - 3 / 4 % 5 ** 2; }
for (int i = 0; i < 10; i++) { continue; } while (true) { break; } do { } while (false);
año = 1; ñandú = 2; $precio = 3; _privado = 4;
`;
const r = lex(estres);
check(r.errors.length === 0, `programa de estrés dio errores: ${JSON.stringify(r.errors)}`);
console.log(`Programa de estrés: ${r.tokens.length} tokens, ${r.errors.length} errores`);

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASARON' : `\n${fallos} PRUEBA(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
