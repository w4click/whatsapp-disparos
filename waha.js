'use strict';
const axios = require('axios');

const BASE_URL = process.env.WAHA_URL || 'https://waha-sr2z.onrender.com';
const API_KEY  = process.env.WAHA_API_KEY || '';

const http = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY }
});

async function configurarWAHA() {
    const APP_URL = process.env.APP_URL || '';
    try {
          const { data: sessao } = await http.get('/api/sessions/default');
          console.log('[WAHA] Status da sessao: ' + sessao.status);
          if (sessao.status !== 'WORKING') {
                  console.log('[WAHA] Tentando iniciar sessao...');
                  await http.post('/api/sessions/default/start').catch(e =>
                            console.error('[WAHA] Erro ao iniciar:', e.message)
                                                                             );
          }
          await http.put('/api/sessions/default', {
                  config: {
                            webhooks: [{
                                        url: APP_URL + '/webhook',
                                        events: ['message', 'message.any'],
                                        hmac: null,
                                        retries: null,
                                        customHeaders: null
                            }]
                  }
          });
          console.log('[WAHA] Webhook configurado: ' + APP_URL + '/webhook');
    } catch (e) {
          console.error('[WAHA] Erro ao configurar:', e.message);
    }
}

async function enviarMensagem(numero, texto) {
    const limpo = numero.replace(/\D/g, '');
    const com55 = limpo.startsWith('55') ? limpo : '55' + limpo;
    await http.post('/api/sendText', {
          session: 'default',
          chatId: com55 + '@c.us',
          text: texto
    });
}

async function simularDigitando(numero) {
    const limpo = numero.replace(/\D/g, '');
    const com55 = limpo.startsWith('55') ? limpo : '55' + limpo;
    const chatId = com55 + '@c.us';
    try {
          await http.post('/api/startTyping', { session: 'default', chatId });
          await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
          await http.post('/api/stopTyping', { session: 'default', chatId });
    } catch (_) {}
}

async function responderDono(texto) {
    const owner = process.env.OWNER_NUMBER || '';
    if (!owner) return;
    await enviarMensagem(owner, texto);
}

module.exports = { configurarWAHA, enviarMensagem, simularDigitando, responderDono };
