const express = require('express');
const { inicializarDB } = require('./models');
const { processarMensagem } = require('./bot');
const { configurarWebhook } = require('./waha');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.post('/webhook', async (req, res) => {
  console.log('[WEBHOOK-RAW]', JSON.stringify(req.body));
  res.sendStatus(200);
  try {
    const payload = req.body?.payload || req.body;
    await processarMensagem(payload);
  } catch (e) { console.log('[WEBHOOK] Erro:', e.message); }
});

app.get('/', (req, res) => res.json({ app: 'whatsapp-disparos', status: 'running' }));

async function iniciar() {
  await inicializarDB();
  app.listen(PORT, () => {
    console.log('[SERVER] Rodando na porta ' + PORT);
    setTimeout(() => configurarWebhook(process.env.APP_URL), 30000);
    setInterval(() => {
      const axios = require('axios');
      axios.get(process.env.APP_URL + '/ping').catch(() => {});
    }, 600000);
  });
}

iniciar();
