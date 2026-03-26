'use strict';
const waha = require('./waha');
const { parsearCSV } = require('./csv');
const { pool } = require('./models');
const { adicionarCampanhaFila, pausarFila, retomarFila, cancelarFila } = require('./queue');
const estadoUsuario = {};

async function processarMensagem(msg) {
  try {
    console.log('[BOT-RAW]', JSON.stringify(msg));
    const chatId = msg?.from || msg?.chatId || '';
    const body = (msg?.body || '').trim();
    if (!chatId || !body) return;
    const sessionInfo = await waha.getSessionInfo().catch(() => null);
    const meId = sessionInfo?.me?.id || '';
    const remetenteNumero = chatId.replace(/@.*$/, '');
    const meuNumero = meId.replace(/@.*$/, '') || process.env.OWNER_NUMBER || '';
    console.log('[BOT] chatId=' + chatId + ' fromMe=' + msg?.fromMe + ' remetente=' + remetenteNumero + ' meu=' + meuNumero);
    const isSelfChat = remetenteNumero === meuNumero;
    if (msg?.fromMe && !isSelfChat) return;
    if (!isSelfChat) {
      if (body.toUpperCase() === 'STOP') {
        await pool.query('INSERT INTO blacklist (numero) VALUES ($1) ON CONFLICT DO NOTHING', [remetenteNumero]);
        await waha.enviarTexto(chatId, 'Voce foi removido da lista de envios.');
      }
      return;
    }
    const cmd = body.toUpperCase();
    const ownerChat = meuNumero + '@c.us';

    if (cmd === 'AJUDA') {
      await waha.enviarTexto(ownerChat, '📋 *Comandos disponiveis:*\n\n' +
        '📝 Envie um texto com variaveis {{nome}}, {{empresa}} para iniciar\n' +
        '📎 Envie um CSV com colunas: numero, nome\n' +
        '▶️ INICIAR - inicia o disparo\n' +
        '⏸ PAUSAR - pausa o disparo\n' +
        '▶️ RETOMAR - retoma o disparo\n' +
        '❌ CANCELAR - cancela o disparo\n' +
        '📊 STATUS - resumo da campanha\n' +
        '❓ AJUDA - mostra este menu');
      return;
    }

    if (cmd === 'STATUS') {
      const r = await pool.query('SELECT * FROM campanhas ORDER BY id DESC LIMIT 1');
      if (!r.rows.length) { await waha.enviarTexto(ownerChat, 'Nenhuma campanha encontrada.'); return; }
      const c = r.rows[0];
      await waha.enviarTexto(ownerChat, '📊 *Status da campanha:*\n' +
        'Status: ' + c.status + '\nTotal: ' + c.total + '\nEnviadas: ' + c.enviadas + '\nErros: ' + c.erros + '\nPendentes: ' + (c.total - c.enviadas - c.erros));
      return;
    }

    if (cmd === 'PAUSAR') { await pausarFila(); await waha.enviarTexto(ownerChat, '⏸ Campanha pausada.'); return; }
    if (cmd === 'RETOMAR') { await retomarFila(); await waha.enviarTexto(ownerChat, '▶️ Campanha retomada.'); return; }
    if (cmd === 'CANCELAR') {
      await cancelarFila();
      await pool.query("UPDATE campanhas SET status='cancelada' WHERE status IN ('disparando','pausada')");
      await waha.enviarTexto(ownerChat, '❌ Campanha cancelada.');
      estadoUsuario.fase = null; return;
    }

    if (cmd === 'INICIAR' && estadoUsuario.fase === 'aguardando_inicio') {
      const campId = estadoUsuario.campanhaId;
      await pool.query("UPDATE campanhas SET status='disparando' WHERE id=$1", [campId]);
      await adicionarCampanhaFila(campId, meuNumero);
      await waha.enviarTexto(ownerChat, '🚀 Campanha iniciada! Voce recebera atualizacoes de progresso aqui.');
      estadoUsuario.fase = null; return;
    }

    if (msg?.hasMedia && estadoUsuario.fase === 'aguardando_csv') {
      await waha.enviarTexto(ownerChat, '⏳ Processando CSV...');
      try {
        const mediaUrl = process.env.WAHA_URL + '/api/files/' + (msg?.mediaUrl || msg?.media?.url || '').split('/').pop();
        const axios = require('axios');
        const resp = await axios.get(mediaUrl, { headers: { 'X-Api-Key': process.env.WAHA_API_KEY }, responseType: 'text' });
        const contatos = parsearCSV(resp.data);
        const campId = estadoUsuario.campanhaId;
        for (const c of contatos) {
          await pool.query('INSERT INTO contatos (campanha_id, numero, nome, extras) VALUES ($1,$2,$3,$4)', [campId, c.numero, c.nome, JSON.stringify(c.extras)]);
        }
        await pool.query('UPDATE campanhas SET status=$1, total=$2 WHERE id=$3', ['pronta', contatos.length, campId]);
        estadoUsuario.fase = 'aguardando_inicio';
        await waha.enviarTexto(ownerChat, '✅ CSV recebido com ' + contatos.length + ' contatos.\n\nCampanha pronta. Responda *INICIAR* para comecar ou *CANCELAR* para descartar.');
      } catch (e) { await waha.enviarTexto(ownerChat, '❌ Erro no CSV: ' + e.message); }
      return;
    }

    if (body.includes('{{') || (!cmd.match(/^[A-Z]+$/) && body.length > 10)) {
      const r = await pool.query("INSERT INTO campanhas (texto) VALUES ($1) RETURNING id", [body]);
      estadoUsuario.campanhaId = r.rows[0].id;
      estadoUsuario.fase = 'aguardando_csv';
      await waha.enviarTexto(ownerChat, '✅ Mensagem salva.\n\nAgora envie o arquivo CSV com os contatos (colunas: numero, nome).');
      return;
    }

    await waha.enviarTexto(ownerChat, 'Comando nao reconhecido. Envie *AJUDA* para ver os comandos.');
  } catch (e) { console.log('[BOT] Erro:', e.message); }
}

module.exports = { processarMensagem };
