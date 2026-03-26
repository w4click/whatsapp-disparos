'use strict';
const waha = require('./waha');
const { query } = require('./models/db');
const { parseCSV } = require('./csv');
const { agendarCampanha, pausarCampanha, retomarCampanha, cancelarCampanha, statusCampanha } = require('./queue');

const estadoUsuario = {};

async function processarMensagem(payload) {
  try {
    const evento = payload.event;
    if (evento !== 'message' && evento !== 'message.any') return;
    const msg = payload.payload;
    const chatId = msg?.from || msg?.chatId;
    if (!chatId) return;
    if (msg?.fromMe) return;
    const sessionInfo = await waha.getSessionInfo().catch(() => null);
    const meId = sessionInfo?.me?.id || '';
    const remetenteNumero = chatId.replace('@c.us', '').replace('@g.us', '');
    const meuNumero = meId.replace('@c.us', '');
    if (chatId.endsWith('@g.us')) return;
    const texto = (msg?.body || '').trim();
    const tipo = msg?.type || 'chat';

    if (texto.toUpperCase() === 'STOP') {
      await query('INSERT INTO blacklist(numero) VALUES($1) ON CONFLICT(numero) DO NOTHING', [remetenteNumero]);
      await waha.sendText(remetenteNumero, 'Seu numero foi adicionado a lista de exclusao.');
      return;
    }

    if (remetenteNumero !== meuNumero) return;

    if (tipo === 'document' || tipo === 'file') {
      await processarArquivoCSV(remetenteNumero, msg);
      return;
    }

    const cmd = texto.toUpperCase();
    switch (cmd) {
      case 'INICIAR':  await cmdIniciar(remetenteNumero);  break;
      case 'PAUSAR':   await cmdPausar(remetenteNumero);   break;
      case 'RETOMAR':  await cmdRetomar(remetenteNumero);  break;
      case 'CANCELAR': await cmdCancelar(remetenteNumero); break;
      case 'STATUS':   await cmdStatus(remetenteNumero);   break;
      case 'AJUDA':    await cmdAjuda(remetenteNumero);    break;
      default:         await cmdSalvarMensagem(remetenteNumero, texto);
    }
  } catch (err) {
    console.error('[BOT] Erro:', err.message);
  }
}

async function cmdSalvarMensagem(numero, texto) {
  if (!texto || texto.length < 3) {
    await waha.sendText(numero, 'Mensagem muito curta. Use variaveis como {{nome}}.');
    return;
  }
  const res = await query("INSERT INTO campanhas(status, mensagem) VALUES('aguardando_csv', $1) RETURNING id", [texto]);
  const campanhaId = res.rows[0].id;
  estadoUsuario[numero] = { fase: 'aguardando_csv', campanhaId };
  await waha.sendText(numero, 'Mensagem salva! Agora envie o arquivo CSV com os contatos. Colunas obrigatorias: numero e nome.');
}

async function processarArquivoCSV(numero, msg) {
  const estado = estadoUsuario[numero];
  if (!estado || estado.fase !== 'aguardando_csv') {
    await waha.sendText(numero, 'Primeiro envie a mensagem de texto antes do CSV.');
    return;
  }
  let csvBuffer;
  try {
    const base64 = msg?.media?.data || msg?.body;
    if (!base64) throw new Error('Arquivo nao encontrado.');
    csvBuffer = Buffer.from(base64, 'base64');
  } catch (e) {
    await waha.sendText(numero, 'Nao consegui ler o arquivo: ' + e.message);
    return;
  }
  let contatos;
  try { contatos = parseCSV(csvBuffer); }
  catch (e) { await waha.sendText(numero, 'Erro no CSV: ' + e.message); return; }
  if (!contatos.length) { await waha.sendText(numero, 'O CSV nao possui contatos validos.'); return; }
  const { campanhaId } = estado;
  for (const c of contatos) {
    await query('INSERT INTO contatos(campanha_id, numero, variaveis) VALUES($1, $2, $3)', [campanhaId, c.numero, JSON.stringify(c.variaveis)]);
  }
  await query("UPDATE campanhas SET total=$1, status='aguardando_confirmacao' WHERE id=$2", [contatos.length, campanhaId]);
  estadoUsuario[numero] = { ...estado, fase: 'aguardando_confirmacao' };
  await waha.sendText(numero, 'CSV recebido com ' + contatos.length + ' contatos! Responda INICIAR para comecar ou CANCELAR para descartar.');
}

async function cmdIniciar(numero) {
  const estado = estadoUsuario[numero];
  if (!estado || estado.fase !== 'aguardando_confirmacao') {
    await waha.sendText(numero, 'Nao ha campanha pronta. Envie a mensagem e o CSV primeiro.'); return;
  }
  const { campanhaId } = estado;
  await query("UPDATE campanhas SET status='ativa', iniciada_em=NOW() WHERE id=$1", [campanhaId]);
  estadoUsuario[numero] = { ...estado, fase: 'em_andamento' };
  await waha.sendText(numero, 'Campanha iniciada! Voce recebera atualizacoes aqui.');
  await agendarCampanha(campanhaId);
}

async function cmdPausar(numero) {
  const camp = await statusCampanha();
  if (!camp || camp.status !== 'ativa') { await waha.sendText(numero, 'Nao ha campanha ativa.'); return; }
  await pausarCampanha(camp.id);
  await waha.sendText(numero, 'Campanha pausada. Enviadas: ' + camp.enviadas + '/' + camp.total + '. Responda RETOMAR para continuar.');
}

async function cmdRetomar(numero) {
  const camp = await statusCampanha();
  if (!camp || camp.status !== 'pausada') { await waha.sendText(numero, 'Nao ha campanha pausada.'); return; }
  await retomarCampanha(camp.id);
  await waha.sendText(numero, 'Campanha retomada!');
}

async function cmdCancelar(numero) {
  const estado = estadoUsuario[numero];
  const camp = await statusCampanha();
  const campanhaId = estado?.campanhaId || camp?.id;
  if (!campanhaId) { await waha.sendText(numero, 'Nao ha campanha ativa.'); return; }
  await cancelarCampanha(campanhaId);
  estadoUsuario[numero] = null;
  await waha.sendText(numero, 'Campanha cancelada.');
}

async function cmdStatus(numero) {
  const camp = await statusCampanha();
  if (!camp) { await waha.sendText(numero, 'Nenhuma campanha ativa.'); return; }
  await waha.sendText(numero, 'Campanha #' + camp.id + ' | Status: ' + camp.status + ' | Total: ' + camp.total + ' | Enviadas: ' + camp.enviadas + ' | Erros: ' + camp.erros);
}

async function cmdAjuda(numero) {
  await waha.sendText(numero,
    'Bot de Disparos\n\n1 - Envie o texto da mensagem com variaveis {{nome}}\n2 - Envie o CSV (colunas: numero, nome)\n3 - Responda INICIAR\n\nComandos: INICIAR, PAUSAR, RETOMAR, CANCELAR, STATUS, AJUDA'
  );
}

module.exports = { processarMensagem };
