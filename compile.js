const bytenode = require('bytenode');
const path = require('path');

const src = path.join(__dirname, 'logic.js');
const dest = path.join(__dirname, 'logic.jsc');

console.log('Compilazione in corso con V8 di Electron...');

// Compila senza il wrapper isolato di Node.js (compileAsModule: false)
bytenode.compileFile({
  filename: src,
  output: dest,
  compileAsModule: false
});

console.log('✅ Compilazione completata: generato logic.jsc globale');