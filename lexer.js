'use strict';

/**
 * ANALIZADOR LÉXICO (Paso 1 del compilador)
 * Convierte el código fuente (texto) en una lista de TOKENS.
 *
 * Diseño: el alfabeto del lenguaje es MUY amplio a propósito. Todos los
 * caracteres ASCII imprimibles tienen un significado léxico definido:
 *
 *   letras      a-z A-Z, _ $ y letras Unicode (ñ, á, é, ü, ...)
 *   dígitos     0-9
 *   operadores  + - * / % ** = == != === !== < > <= >= && || ! ?? & | ^ ~
 *               << >> >>> ++ -- += -= *= /= %= **= &= |= ^= <<= >>= >>>=
 *               ? : . ... -> => ?.
 *   delimitad.  ( ) { } [ ] ; ,
 *   símbolos    @ # \
 *   cadenas     "..."  '...'  `...`
 *   comentarios // de línea  y  barra-asterisco de bloque
 */

// 1) Categorías de tokens
const TokenType = Object.freeze({
  KEYWORD: 'KEYWORD',       // palabras reservadas: if, while, let, ...
  TYPE: 'TYPE',             // tipos: int, float, string, bool, ...
  IDENTIFIER: 'IDENTIFIER', // nombres de variables / funciones
  INT: 'INT',               // 42, 0xFF, 0b101, 0o17, 1_000
  FLOAT: 'FLOAT',           // 3.14, .5, 1e10, 2.5E-3
  STRING: 'STRING',         // "texto", 'texto', `texto`
  ARITHMETIC: 'ARITHMETIC', // + - * / % **
  ASSIGNMENT: 'ASSIGNMENT', // = += -= *= /= ...
  COMPARISON: 'COMPARISON', // == != === !== < > <= >=
  LOGICAL: 'LOGICAL',       // && || ! ??
  BITWISE: 'BITWISE',       // & | ^ ~ << >> >>>
  INCDEC: 'INCDEC',         // ++ --
  OPERATOR: 'OPERATOR',     // ? : . ... -> => ?.
  DELIMITER: 'DELIMITER',   // ( ) { } [ ] ; ,
  SYMBOL: 'SYMBOL',         // @ # \
  EOF: 'EOF',               // fin de archivo
});

// 2) Palabras reservadas y tipos
const KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'print', 'func', 'function',
  'let', 'const', 'var', 'true', 'false', 'null', 'undefined',
  'new', 'this', 'class', 'try', 'catch', 'finally', 'throw',
  'in', 'of', 'typeof', 'import', 'export',
]);
const TYPES = new Set(['int', 'float', 'double', 'string', 'bool', 'boolean', 'char', 'long', 'short', 'void']);

// 3) Operadores, delimitadores y símbolos: lexema -> categoría
const OPERATORS = new Map();
const addOps = (type, list) => list.forEach((o) => OPERATORS.set(o, type));
addOps('ARITHMETIC', ['+', '-', '*', '/', '%', '**']);
addOps('ASSIGNMENT', ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);
addOps('COMPARISON', ['==', '!=', '===', '!==', '<', '>', '<=', '>=']);
addOps('LOGICAL', ['&&', '||', '!', '??']);
addOps('BITWISE', ['&', '|', '^', '~', '<<', '>>', '>>>']);
addOps('INCDEC', ['++', '--']);
addOps('OPERATOR', ['?', ':', '.', '...', '->', '=>', '?.']);
addOps('DELIMITER', ['(', ')', '{', '}', '[', ']', ';', ',']);
addOps('SYMBOL', ['@', '#', '\\']);
const MAX_OP_LEN = 4; // el más largo es >>>=

// Funciones auxiliares de clasificación de caracteres
const isDigit = (c) => c >= '0' && c <= '9';
const isHexDigit = (c) => /^[0-9a-fA-F]$/.test(c);
const isLetter = (c) => /^[\p{L}_$]$/u.test(c);                 // letras Unicode, _ y $
const isAlphaNum = (c) => isLetter(c) || isDigit(c) || /^\p{M}$/u.test(c);

class Token {
  constructor(type, lexeme, value, line, column) {
    this.type = type;     // categoría
    this.lexeme = lexeme; // texto exacto encontrado en el código
    this.value = value;   // valor ya interpretado (número, string sin comillas, ...)
    this.line = line;
    this.column = column;
  }
}

class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.errors = [];
  }

  // ---------- utilidades de lectura ----------
  isAtEnd() { return this.pos >= this.src.length; }

  peek(offset = 0) {
    const i = this.pos + offset;
    return i < this.src.length ? this.src[i] : '\0';
  }

  advance() {
    const c = this.src[this.pos++];
    if (c === '\n') { this.line++; this.col = 1; } else { this.col++; }
    return c;
  }

  addToken(type, lexeme, value, line, column) {
    this.tokens.push(new Token(type, lexeme, value, line, column));
  }

  addError(message, line, column) {
    this.errors.push({ message, line, column });
  }

  // ---------- ciclo principal ----------
  tokenize() {
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const line = this.line;
      const column = this.col;
      const c = this.peek();

      if (isLetter(c)) this.readWord(line, column);
      else if (isDigit(c) || (c === '.' && isDigit(this.peek(1)))) this.readNumber(line, column);
      else if (c === '"' || c === "'" || c === '`') this.readString(line, column);
      else if (!this.readOperatorOrDelimiter(line, column)) {
        // Carácter desconocido: se reporta y se continúa (recuperación de errores)
        this.addError(`Carácter no reconocido '${c}'`, line, column);
        this.advance();
      }
    }
    this.addToken(TokenType.EOF, '', null, this.line, this.col);
    return { tokens: this.tokens, errors: this.errors };
  }

  // ---------- espacios y comentarios ----------
  skipWhitespaceAndComments() {
    while (!this.isAtEnd()) {
      const c = this.peek();
      if (/\s/.test(c)) {
        this.advance();
      } else if (c === '/' && this.peek(1) === '/') {
        // comentario de línea
        while (!this.isAtEnd() && this.peek() !== '\n') this.advance();
      } else if (c === '/' && this.peek(1) === '*') {
        // comentario de bloque
        const line = this.line, column = this.col;
        this.advance(); this.advance();
        let closed = false;
        while (!this.isAtEnd()) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance(); this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) this.addError('Comentario de bloque sin cerrar', line, column);
      } else {
        break;
      }
    }
  }

  // ---------- identificadores y palabras reservadas ----------
  readWord(line, column) {
    let text = '';
    while (!this.isAtEnd() && isAlphaNum(this.peek())) text += this.advance();

    if (TYPES.has(text)) this.addToken(TokenType.TYPE, text, text, line, column);
    else if (KEYWORDS.has(text)) {
      const value = text === 'true' ? true : text === 'false' ? false : text;
      this.addToken(TokenType.KEYWORD, text, value, line, column);
    } else this.addToken(TokenType.IDENTIFIER, text, text, line, column);
  }

  // ---------- números: decimal, decimal con punto, exponente, hex/bin/octal ----------
  readNumber(line, column) {
    // 0x1F, 0b101, 0o17
    if (this.peek() === '0' && /^[xXbBoO]$/.test(this.peek(1))) {
      this.readRadixNumber(line, column);
      return;
    }

    let text = '';
    // dígitos con separador "_" permitido entre dígitos (1_000)
    const readDigits = () => {
      while (isDigit(this.peek()) ||
        (this.peek() === '_' && isDigit(this.peek(1)) && isDigit(text[text.length - 1] || ''))) {
        text += this.advance();
      }
    };

    readDigits();

    let isFloat = false;
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      isFloat = true;
      text += this.advance(); // el punto
      readDigits();
    }

    // exponente: e10, E+5, e-3
    if (/^[eE]$/.test(this.peek())) {
      const s = this.peek(1);
      if (isDigit(s) || ((s === '+' || s === '-') && isDigit(this.peek(2)))) {
        isFloat = true;
        text += this.advance();                       // e / E
        if (!isDigit(this.peek())) text += this.advance(); // signo
        readDigits();
      }
    }

    // Caso inválido: número pegado a letras o '_', ej. 12abc, 5_
    if (!this.isAtEnd() && isLetter(this.peek())) {
      while (!this.isAtEnd() && isAlphaNum(this.peek())) text += this.advance();
      this.addError(`Número mal formado '${text}'`, line, column);
      return;
    }

    const clean = text.replace(/_/g, '');
    if (isFloat) this.addToken(TokenType.FLOAT, text, parseFloat(clean), line, column);
    else this.addToken(TokenType.INT, text, Number(clean), line, column);
  }

  readRadixNumber(line, column) {
    let text = this.advance() + this.advance(); // "0x", "0b" o "0o"
    const radix = { x: 16, b: 2, o: 8 }[text[1].toLowerCase()];
    const valid = radix === 16 ? isHexDigit
      : radix === 2 ? (c) => c === '0' || c === '1'
        : (c) => c >= '0' && c <= '7';

    let digits = '';
    while (valid(this.peek()) || (this.peek() === '_' && digits && valid(this.peek(1)))) {
      const ch = this.advance();
      text += ch;
      if (ch !== '_') digits += ch;
    }

    if (!digits || (!this.isAtEnd() && isAlphaNum(this.peek()))) {
      while (!this.isAtEnd() && isAlphaNum(this.peek())) text += this.advance();
      this.addError(`Número mal formado '${text}'`, line, column);
      return;
    }
    this.addToken(TokenType.INT, text, parseInt(digits, radix), line, column);
  }

  // ---------- cadenas de texto: "..." '...' `...` ----------
  readString(line, column) {
    const quote = this.advance();           // comilla de apertura
    const multiline = quote === '`';        // solo las comillas invertidas aceptan saltos de línea
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\\': '\\', '"': '"', "'": "'", '`': '`' };
    let value = '';
    let lexeme = quote;

    while (!this.isAtEnd() && this.peek() !== quote && (multiline || this.peek() !== '\n')) {
      if (this.peek() === '\\') {
        const eLine = this.line, eCol = this.col;
        lexeme += this.advance();
        if (this.isAtEnd()) break;
        const esc = this.advance();
        lexeme += esc;

        if (Object.prototype.hasOwnProperty.call(simple, esc)) {
          value += simple[esc];
        } else if (esc === 'x' || esc === 'u') {
          const n = esc === 'x' ? 2 : 4;
          let hex = '';
          while (hex.length < n && isHexDigit(this.peek())) { hex += this.peek(); lexeme += this.advance(); }
          if (hex.length === n) value += String.fromCharCode(parseInt(hex, 16));
          else this.addError(`Secuencia de escape inválida '\\${esc}${hex}'`, eLine, eCol);
        } else if (esc === '\n') {
          // "\" al final de línea: continuación de cadena
        } else {
          this.addError(`Secuencia de escape inválida '\\${esc}'`, eLine, eCol);
        }
      } else {
        const ch = this.advance();
        lexeme += ch;
        value += ch;
      }
    }

    if (this.peek() !== quote) {
      this.addError('Cadena de texto sin cerrar', line, column);
      return;
    }
    this.advance(); // comilla de cierre
    lexeme += quote;
    this.addToken(TokenType.STRING, lexeme, value, line, column);
  }

  // ---------- operadores, delimitadores y símbolos (el más largo primero) ----------
  readOperatorOrDelimiter(line, column) {
    for (let len = MAX_OP_LEN; len >= 1; len--) {
      const s = this.src.substr(this.pos, len);
      if (s.length === len && OPERATORS.has(s)) {
        for (let i = 0; i < len; i++) this.advance();
        this.addToken(OPERATORS.get(s), s, s, line, column);
        return true;
      }
    }
    return false;
  }
}

// Compatible con Node.js (require) y con el navegador (<script src="lexer.js">)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Lexer, Token, TokenType, KEYWORDS, TYPES, OPERATORS };
} else {
  window.Lexer = Lexer;
  window.TokenType = TokenType;
  window.KEYWORDS = KEYWORDS;
  window.TYPES = TYPES;
  window.OPERATORS = OPERATORS;
}
