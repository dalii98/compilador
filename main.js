'use strict';
const { Lexer } = require('./lexer');

function analizar(titulo, codigo) {
  console.log(`\n=== ${titulo} ===`);
  console.log(codigo);
  const { tokens, errors } = new Lexer(codigo).tokenize();

  console.table(tokens.map((t) => ({
    tipo: t.type, lexema: t.lexeme, linea: t.line, columna: t.column,
  })));

  if (errors.length) {
    console.log('ERRORES LÉXICOS:');
    errors.forEach((e) => console.log(`  [${e.line}:${e.column}] ${e.message}`));
  } else {
    console.log('Sin errores léxicos.');
  }
}

analizar('Código válido', `
// declaración de variables
int edad = 20;
float pi = 3.14;
string nombre = "Ana";
if (edad >= 18 && pi != 0) {
  print(nombre);
}
`);

analizar('Código con errores', `
int x = 12abc;
string s = "sin cerrar;
int y = 5 ¿ 3;
/* comentario sin cerrar
`);
