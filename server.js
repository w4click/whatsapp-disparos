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

// --- Middlewares
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
});

// --- Webhook principal do WAHA
app.post('/webhook', async (req, res) => {
    try {
          res.status(200).json({ received: true });
          setImmediate(() => processarMensagem(req.body).catch(console.error));
    } catch (err) {
          console.error('[WEBHOOK] Erro:', err.message);
          res.status(500).json({ error: err.message });
    }
});

// --- API de status
app.get('/api/status', async (req, res) => {
    try {
          const camp = await statusCampanha();
          res.json({ campanha: camp || null });
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

// --- Keep-alive: evita hibernacao do Render e reconfiga webhook se necessario
const waha = require('./waha');
const axios = require('axios');

const SELF_URL    = process.env.SELF_URL || 'https://whatsapp-disparos-8m21.onrender.com';
const WEBHOOK_URL = SELF_URL + '/webhook';
const KEEPALIVE_MS = 10 * 60 * 1000;

async function keepAlive() {
    try {
          const info = await waha.getSessionInfo().catch(() => null);
          const status = info && info.status;
          console.log('[KEEPALIVE] WAHA status: ' + (status || 'inacessivel'));
          if (!info) return;
          if (status === 'STOPPED' || status === 'FAILED') {
                  console.log('[KEEPALIVE] Sessao caida, reiniciando...');
                  await waha.startSession().catch(e => console.error('[KEEPALIVE] Erro ao reiniciar:', e.message));
                  return;
          }
          const webhooks = info && info.config && info.config.webhooks;
          if (!webhooks || webhooks.length === 0) {
                  console.log('[KEEPALIVE] Webhook nao configurado, reconfigurando...');
                  const wahaBase = process.env.WAHA_BASE_URL || 'https://waha-sr2z.onrender.com';
                  await axios.put(
                            wahaBase + '/api/sessions/default',
                    { config: { webhooks: [{ url: WEBHOOK_URL, events: ['message', 'message.any', 'session.status'], hmac: null, retries: null, customHeaders: null }] } },
                    { headers: { 'X-Api-Key': process.env.WAHA_API_KEY || '', 'Content-Type': 'application/json' }, timeout: 15000 }
                          ).catch(e => console.error('[KEEPALIVE] Erro ao configurar webhook:', e.message));
                  console.log('[KEEPALIVE] Webhook reconfigurado para: ' + WEBHOOK_URL);
          }
    } catch (e) {
          console.error('[KEEPALIVE] Erro geral:', e.message);
    }
}

// --- Inicializacao
async function start() {
    try {
          await initDB();
          app.listen(PORT, () => {
                  console.log('[SERVER] Rodando na porta ' + PORT);
                  console.log('[SERVER] WAHA base URL: ' + process.env.WAHA_BASE_URL);
                  keepAlive();
                  setInterval(keepAlive, KEEPALIVE_MS);
                  console.log('[SERVER] Keep-alive ativo a cada ' + (KEEPALIVE_MS / 60000) + ' min');
          });
    } catch (err) {
          console.error('[SERVER] Falha ao iniciar:', err.message);
          process.exit(1);
    }
}

start();

module.exports = app;
