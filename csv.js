const { parse } = require('csv-parse/sync');

function parsearCSV(conteudo) {
  const registros = parse(conteudo, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  if (!registros.length) throw new Error('CSV vazio');
  const colunas = Object.keys(registros[0]).map(c => c.toLowerCase());
  if (!colunas.includes('numero')) throw new Error('Coluna "numero" obrigatoria no CSV');
  if (!colunas.includes('nome')) throw new Error('Coluna "nome" obrigatoria no CSV');
  return registros.map(r => {
    const obj = {};
    Object.keys(r).forEach(k => { obj[k.toLowerCase()] = r[k]; });
    const { numero, nome, ...extras } = obj;
    return { numero: numero.replace(/\D/g, ''), nome, extras };
  });
}

module.exports = { parsearCSV };
