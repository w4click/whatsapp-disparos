const axios = require('axios');
const WAHA = axios.create({
  baseURL: process.env.WAHA_URL,
  headers: { 'X-Api-Key': process.env.WAHA_API_KEY, 'Content-Type': 'application/json' }
});

async function getSessionInfo() {
  const { data } = await WAHA.get('/api/sessions/default');
  return data;
}

async function enviarTexto(chatId, texto) {
  const { data } = await WAHA.post('/api/sendText', { session: 'default', chatId, text: texto });
  return data;
}

async function marcarVisto(chatId) {
  await WAHA.post('/api/sendSeen', { session: 'default', chatId }).catch(() => {});
}

async function simularDigitando(chatId) {
  await WAHA.post('/api/startTyping', { session: 'default', chatId }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
  await WAHA.post('/api/stopTyping', { session: 'default', chatId }).catch(() => {});
}

async function configurarWebhook(appUrl) {
  try {
    const info = await getSessionInfo().catch(() => null);
    if (!info || info.status === 'STOPPED') {
      await WAHA.post('/api/sessions/start', { name: 'default', config: { webhooks: [{ url: appUrl + '/webhook', events: ['message', 'message.any'] }] } }).catch(() => {});
      console.log('[WAHA] Sessao iniciada com webhook');
    } else {
      await WAHA.put('/api/sessions/default', { config: { webhooks: [{ url: appUrl + '/webhook', events: ['message', 'message.any'] }] } }).catch(() => {});
      console.log('[WAHA] Webhook atualizado');
    }
  } catch (e) { console.log('[WAHA] Erro ao configurar webhook:', e.message); }
}

module.exports = { getSessionInfo, enviarTexto, marcarVisto, simularDigitando, configurarWebhook };
