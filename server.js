'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');
const { initDB } = require('./models/db');
const { processarMensagem } = require('./bot');
const { statusCampanha }    = require('./queue');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.post('/webhook', async (req, res) => {
  try {
    res.status(200).json({ received: true });
    setImmediate(() => processarMensagem(req.body).catch(console.error));
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const camp = await statusCampanha();
    res.json({ campanha: camp || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log('[SERVER] Aplicativo de disparos rodando na porta ' + PORT);
      console.log('[SERVER] Webhook: POST /webhook');
      console.log('[SERVER] WAHA base URL: ' + process.env.WAHA_BASE_URL);
    });
  } catch (err) {
    console.error('[SERVER] Falha ao iniciar:', err.message);
    process.exit(1);
  }
}

start();
module.exports = app;
