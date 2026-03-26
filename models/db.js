'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS campanhas (
      id           SERIAL PRIMARY KEY,
      status       TEXT    NOT NULL DEFAULT 'aguardando_mensagem',
      mensagem     TEXT,
      total        INT     DEFAULT 0,
      enviadas     INT     DEFAULT 0,
      erros        INT     DEFAULT 0,
      iniciada_em  TIMESTAMPTZ,
      finalizada_em TIMESTAMPTZ,
      criada_em    TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contatos (
      id           SERIAL PRIMARY KEY,
      campanha_id  INT     NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
      numero       TEXT    NOT NULL,
      variaveis    JSONB   DEFAULT '{}',
      status       TEXT    NOT NULL DEFAULT 'pendente',
      tentativas   INT     DEFAULT 0,
      enviado_em   TIMESTAMPTZ,
      erro_msg     TEXT,
      criado_em    TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id         SERIAL PRIMARY KEY,
      numero     TEXT UNIQUE NOT NULL,
      motivo     TEXT DEFAULT 'STOP',
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_contatos_campanha
      ON contatos(campanha_id, status);
  `);

  console.log('[DB] Tabelas inicializadas com sucesso.');
}

module.exports = { query, initDB, pool };
