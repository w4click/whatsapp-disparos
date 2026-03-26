'use strict';
require('dotenv').config();

const Bull   = require('bull');
const waha   = require('./waha');
const { query } = require('./models/db');
const { interpolate } = require('./csv');
const axios  = require('axios');

const dispatchQueue = new Bull('disparos', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

const INTERVALO_MIN_MS   = 45000;
const INTERVALO_MAX_MS   = 120000;
const LIMITE_HORA        = 50;
const LIMITE_DIA         = 200;
const BLOCO_PAUSA        = 20;
const PAUSA_BLOCO_MIN_MS = 10 * 60000;
const PAUSA_BLOCO_MAX_MS = 20 * 60000;
const HORA_INICIO        = parseInt(process.env.ENVIO_HORA_INICIO || '9',  10);
const HORA_FIM           = parseInt(process.env.ENVIO_HORA_FIM   || '18', 10);

let msgHoraAtual = 0, msgDiaAtual = 0, ultimaMsgTexto = '', msgNoBloco = 0;
let ultimaHora = new Date().getHours(), ultimoDia = new Date().getDate();

function resetarContadoresSeNecessario() {
  const agora = new Date();
  if (agora.getHours() !== ultimaHora) { msgHoraAtual = 0; ultimaHora = agora.getHours(); }
  if (agora.getDate()  !== ultimoDia)  { msgDiaAtual  = 0; ultimoDia  = agora.getDate();  }
}

function horaAtualBRT() {
  return parseInt(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
}

function isDentroDoHorario() {
  const hora = horaAtualBRT();
  return hora >= HORA_INICIO && hora < HORA_FIM;
}

async function aguardarProximoHorario() {
  const agora = new Date(), amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(HORA_INICIO, 0, 0, 0);
  const diff = amanha.getTime() - agora.getTime();
  console.log('[QUEUE] Fora do horario. Aguardando ' + Math.round(diff / 60000) + ' min.');
  await new Promise((r) => setTimeout(r, diff));
}

function randomDelay(min, max) {
  min = min || INTERVALO_MIN_MS; max = max || INTERVALO_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

dispatchQueue.process(1, async (job) => {
  const { contatoId, campanhaId } = job.data;
  const campRes = await query('SELECT status, mensagem FROM campanhas WHERE id = $1', [campanhaId]);
  if (!campRes.rows.length) throw new Error('Campanha nao encontrada.');
  const { status: campStatus, mensagem } = campRes.rows[0];
  if (campStatus === 'cancelada') { await query('UPDATE contatos SET status=$1 WHERE id=$2', ['cancelado', contatoId]); return; }
  if (campStatus === 'pausada')   { await job.moveToFailed({ message: 'pausada' }, true); return; }
  if (!isDentroDoHorario()) await aguardarProximoHorario();

  const ctRes = await query('SELECT * FROM contatos WHERE id = $1 AND status = $2', [contatoId, 'pendente']);
  if (!ctRes.rows.length) return;
  const contato = ctRes.rows[0];

  const blRes = await query('SELECT id FROM blacklist WHERE numero = $1', [contato.numero]);
  if (blRes.rows.length) {
    await query('UPDATE contatos SET status=$1 WHERE id=$2', ['blacklist', contatoId]);
    await query('UPDATE campanhas SET enviadas=enviadas+1 WHERE id=$1', [campanhaId]);
    return;
  }

  resetarContadoresSeNecessario();
  if (msgHoraAtual >= LIMITE_HORA || msgDiaAtual >= LIMITE_DIA) {
    await new Promise((r) => setTimeout(r, msgHoraAtual >= LIMITE_HORA ? 65000 : 24 * 3600000));
    resetarContadoresSeNecessario();
  }

  let textoFinal = interpolate(mensagem, contato.variaveis || {});
  if (textoFinal === ultimaMsgTexto) textoFinal = textoFinal + ' ';
  ultimaMsgTexto = textoFinal;

  try {
    await waha.sendSeen(contato.numero);
    await waha.startTyping(contato.numero, randomDelay(1500, 4000));
    await waha.sendText(contato.numero, textoFinal);
    await query('UPDATE contatos SET status=$1, enviado_em=NOW(), tentativas=tentativas+1 WHERE id=$2', ['enviado', contatoId]);
    await query('UPDATE campanhas SET enviadas=enviadas+1 WHERE id=$1', [campanhaId]);
    msgHoraAtual++; msgDiaAtual++; msgNoBloco++;
    console.log('[QUEUE] Enviado para ' + contato.numero);
  } catch (err) {
    await query('UPDATE contatos SET status=$1, erro_msg=$2, tentativas=tentativas+1 WHERE id=$3', ['erro', err.message, contatoId]);
    await query('UPDATE campanhas SET erros=erros+1, enviadas=enviadas+1 WHERE id=$1', [campanhaId]);
    console.error('[QUEUE] Erro para ' + contato.numero + ': ' + err.message);
  }

  if (msgNoBloco >= BLOCO_PAUSA) {
    msgNoBloco = 0;
    const pausa = randomDelay(PAUSA_BLOCO_MIN_MS, PAUSA_BLOCO_MAX_MS);
    console.log('[QUEUE] Pausa de bloco: ' + Math.round(pausa / 60000) + ' min.');
    await new Promise((r) => setTimeout(r, pausa));
  }

  await verificarProgressoCampanha(campanhaId);
  await new Promise((r) => setTimeout(r, randomDelay()));
});

async function verificarProgressoCampanha(campanhaId) {
  const res = await query('SELECT total, enviadas, erros, status FROM campanhas WHERE id=$1', [campanhaId]);
  if (!res.rows.length) return;
  const { total, enviadas, erros, status } = res.rows[0];
  if (!total) return;

  if (enviadas >= total && status === 'ativa') {
    await query('UPDATE campanhas SET status=$1, finalizada_em=NOW() WHERE id=$2', ['finalizada', campanhaId]);
    const msg = '*Campanha concluida!*\n\nTotal: ' + total + '\nEnviadas: ' + (enviadas - erros) + '\nErros: ' + erros;
    await waha.sendToOwner(msg);
    try {
      if (process.env.N8N_WEBHOOK_URL) {
        await axios.post(process.env.N8N_WEBHOOK_URL, { campanhaId, total, enviadas: enviadas - erros, erros, finalizadaEm: new Date().toISOString() });
      }
    } catch (e) { console.error('[QUEUE] Erro n8n:', e.message); }
  }
}

async function agendarCampanha(campanhaId) {
  const res = await query('SELECT id, numero FROM contatos WHERE campanha_id=$1 AND status=$2 ORDER BY id', [campanhaId, 'pendente']);
  let delay = 0;
  for (const contato of res.rows) {
    await dispatchQueue.add({ contatoId: contato.id, campanhaId }, { delay, priority: 1 });
    delay += randomDelay();
  }
  console.log('[QUEUE] ' + res.rows.length + ' jobs agendados para campanha ' + campanhaId);
}

async function pausarCampanha(campanhaId)   { await query('UPDATE campanhas SET status=$1 WHERE id=$2', ['pausada',  campanhaId]); }
async function retomarCampanha(campanhaId)  { await query('UPDATE campanhas SET status=$1 WHERE id=$2', ['ativa',    campanhaId]); await agendarCampanha(campanhaId); }
async function cancelarCampanha(campanhaId) {
  await query('UPDATE campanhas SET status=$1 WHERE id=$2', ['cancelada', campanhaId]);
  await query('UPDATE contatos SET status=$1 WHERE campanha_id=$2 AND status=$3', ['cancelado', campanhaId, 'pendente']);
}
async function statusCampanha() {
  const res = await query("SELECT id, total, enviadas, erros, status, iniciada_em FROM campanhas WHERE status IN ('ativa','pausada','aguardando_csv','aguardando_confirmacao') ORDER BY id DESC LIMIT 1");
  return res.rows[0] || null;
}

dispatchQueue.on('failed', (job, err) => { if (err.message !== 'pausada') console.error('[QUEUE] Job ' + job.id + ' falhou:', err.message); });

module.exports = { dispatchQueue, agendarCampanha, pausarCampanha, retomarCampanha, cancelarCampanha, statusCampanha };
