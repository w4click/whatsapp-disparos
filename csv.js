'use strict';
const { parse } = require('csv-parse/sync');

function parseCSV(buffer) {
  let records;
  try {
    records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    throw new Error('CSV invalido: ' + e.message);
  }
  if (!records || records.length === 0) throw new Error('O CSV esta vazio.');
  const colunas = Object.keys(records[0]).map((c) => c.toLowerCase());
  if (!colunas.includes('numero')) throw new Error('O CSV precisa ter a coluna "numero".');
  if (!colunas.includes('nome')) throw new Error('O CSV precisa ter a coluna "nome".');
  return records.map((row, idx) => {
    const rowNorm = {};
    for (const [k, v] of Object.entries(row)) rowNorm[k.toLowerCase()] = (v || '').trim();
    const numero = rowNorm.numero.replace(/\D/g, '');
    if (!numero || numero.length < 10) throw new Error('Linha ' + (idx + 2) + ': numero invalido "' + rowNorm.numero + '".');
    const variaveis = {};
    for (const [k, v] of Object.entries(rowNorm)) if (k !== 'numero') variaveis[k] = v;
    return { numero, variaveis };
  });
}

function interpolate(mensagem, variaveis) {
  let texto = mensagem;
  for (const [chave, valor] of Object.entries(variaveis)) {
    const regex = new RegExp('\\{\\{\\s*' + chave + '\\s*\\}\\}', 'gi');
    texto = texto.replace(regex, valor || '');
  }
  return texto;
}

module.exports = { parseCSV, interpolate };
