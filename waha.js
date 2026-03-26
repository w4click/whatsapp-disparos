'use strict';
const axios = require('axios');

const BASE_URL = process.env.WAHA_BASE_URL || 'http://localhost:3001';
const API_KEY  = process.env.WAHA_API_KEY  || '';
const SESSION  = 'default';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
  },
});

http.interceptors.response.use(
  (r) => r,
  (e) => {
    const msg = e.response?.data?.message || e.message;
    throw new Error('[WAHA] ' + msg);
  }
);

function formatNumber(numero) {
  const limpo = numero.replace(/\D/g, '');
  const com55 = limpo.startsWith('55') ? limpo : '55' + limpo;
  return com55 + '@c.us';
}

async function sendText(numero, texto) {
  const chatId = formatNumber(numero);
  await http.post('/api/sendText', { session: SESSION, chatId, text: texto });
}

async function sendSeen(numero) {
  try {
    const chatId = formatNumber(numero);
    await http.post('/api/' + SESSION + '/chats/' + encodeURIComponent(chatId) + '/messages/seen', {});
  } catch (_) {}
}

async function startTyping(numero, durationMs = 3000) {
  try {
    const chatId = formatNumber(numero);
    await http.post('/api/startTyping', { session: SESSION, chatId });
    await new Promise((r) => setTimeout(r, durationMs));
    await http.post('/api/stopTyping', { session: SESSION, chatId });
  } catch (_) {}
}

async function sendToOwner(texto) {
  try {
    const info = await getSessionInfo();
    if (!info || !info.me) return;
    const ownerNumber = info.me.id.replace('@c.us', '');
    await sendText(ownerNumber, texto);
  } catch (e) {
    console.error('[WAHA] Erro ao enviar para owner:', e.message);
  }
}

async function getSessionInfo() {
  const r = await http.get('/api/sessions/' + SESSION);
  return r.data;
}

async function startSession() {
  await http.post('/api/sessions/start', { name: SESSION });
}

async function getQR() {
  const r = await http.get('/api/' + SESSION + '/auth/qr');
  return r.data;
}

async function stopSession() {
  await http.post('/api/sessions/stop', { name: SESSION, logout: false });
}

module.exports = { sendText, sendSeen, startTyping, sendToOwner, getSessionInfo, startSession, getQR, stopSession, formatNumber };
