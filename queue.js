const Queue = require('bull');
const waha = require('./waha');
const { pool } = require('./models');

const filaDisparos = new Queue('disparos', process.env.REDIS_URL, {
  redis: { tls: process.env.REDIS_URL?.startsWith('rediss') ? { rejectUnauthorized: false } : undefined }
});

let contadorHora = 0, contadorDia = 0, contadorBloco = 0, ultimaMsg = '', resetHora = Date.now(), resetDia = Date.now();

function dentroHorario() { const h = new Date().getHours(); return h >= 9 && h < 18; }

function delay(min, max) { return new Promise(r => setTimeout(r, (min + Math.random() * (max - min)) * 1000)); }

async function adicionarCampanhaFila(campanhaId, meuNumero) {
  const contatos = await pool.query("SELECT * FROM contatos WHERE campanha_id=$1 AND status='pendente'", [campanhaId]);
  for (const contato of contatos.rows) {
    await filaDisparos.add({ campanhaId, contatoId: contato.id, numero: contato.numero, nome: contato.nome, extras: contato.extras, meuNumero }, { attempts: 2, backoff: 60000 });
  }
}

async function pausarFila() { await filaDisparos.pause(); }
async function retomarFila() { await filaDisparos.resume(); }
async function cancelarFila() { await filaDisparos.pause(); await filaDisparos.empty(); }

filaDisparos.process(1, async (job) => {
  const { campanhaId, contatoId, numero, nome, extras, meuNumero } = job.data;
  if (!dentroHorario()) { throw new Error('Fora do horario - retry'); }
  if (Date.now() - resetHora > 3600000) { contadorHora = 0; resetHora = Date.now(); }
  if (Date.now() - resetDia > 86400000) { contadorDia = 0; resetDia = Date.now(); }
  if (contadorHora >= 50) { await delay(300, 600); contadorHora = 0; }
  if (contadorDia >= 200) { throw new Error('Limite diario atingido'); }
  const bl = await pool.query('SELECT 1 FROM blacklist WHERE numero=$1', [numero]);
  if (bl.rows.length) { await pool.query("UPDATE contatos SET status='blacklist' WHERE id=$1", [contatoId]); return; }
  const campanha = await pool.query('SELECT texto FROM campanhas WHERE id=$1', [campanhaId]);
  let texto = campanha.rows[0].texto;
  texto = texto.replace(/\{\{nome\}\}/gi, nome || '');
  texto = texto.replace(/\{\{empresa\}\}/gi, (extras?.empresa) || '');
  Object.keys(extras || {}).forEach(k => { texto = texto.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'gi'), extras[k] || ''); });
  if (texto === ultimaMsg) texto += '\u200B';
  ultimaMsg = texto;
  const chatId = numero + '@c.us';
  await waha.marcarVisto(chatId);
  await waha.simularDigitando(chatId);
  await waha.enviarTexto(chatId, texto);
  await pool.query("UPDATE contatos SET status='enviado' WHERE id=$1", [contatoId]);
  await pool.query("UPDATE campanhas SET enviadas = enviadas + 1 WHERE id=$1", [campanhaId]);
  contadorHora++; contadorDia++; contadorBloco++;
  const camp = (await pool.query('SELECT * FROM campanhas WHERE id=$1', [campanhaId])).rows[0];
  const progresso = Math.floor((camp.enviadas / camp.total) * 100);
  const ownerChat = meuNumero + '@c.us';
  if (progresso > 0 && progresso % 25 === 0) {
    await waha.enviarTexto(ownerChat, '📊 Progresso: ' + camp.enviadas + ' de ' + camp.total + ' mensagens enviadas (' + progresso + '%)');
  }
  if (camp.enviadas + camp.erros >= camp.total) {
    await pool.query("UPDATE campanhas SET status='concluida' WHERE id=$1", [campanhaId]);
    await waha.enviarTexto(ownerChat, '✅ Campanha concluida!\nTotal: ' + camp.total + '\nEnviadas: ' + camp.enviadas + '\nErros: ' + camp.erros);
  }
  if (contadorBloco >= 20) { contadorBloco = 0; await delay(600, 1200); }
  await delay(45, 120);
});

filaDisparos.on('failed', async (job, err) => {
  console.log('[QUEUE] Falha:', err.message);
  if (err.message !== 'Fora do horario - retry') {
    await pool.query("UPDATE contatos SET status='erro', erro=$1 WHERE id=$2", [err.message, job.data.contatoId]);
    await pool.query("UPDATE campanhas SET erros = erros + 1 WHERE id=$1", [job.data.campanhaId]);
  }
});

module.exports = { adicionarCampanhaFila, pausarFila, retomarFila, cancelarFila };
