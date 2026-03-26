'use strict';
require('dotenv').config();
const { Pool } = require('pg');

// ─── Pool ──────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4,   // força IPv4 — necessário no Render Free tier
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

/**
 * Helper para executar queries
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Cria as tabelas necessárias se não existirem
 */
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS campanhas (
      id           SERIAL PRIMARY KEY,
      status       VARCHAR(30)  NOT NULL DEFAULT 'aguardando_csv',
      mensagem     TEXT,
      total        INTEGER      DEFAULT 0,
      enviadas     INTEGER      DEFAULT 0,
      erros        INTEGER      DEFAULT 0,
      criada_em    TIMESTAMPTZ  DEFAULT NOW(),
      iniciada_em  TIMESTAMPTZ,
      finalizada_em TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contatos (
      id           SERIAL PRIMARY KEY,
      campanha_id  INTEGER      REFERENCES campanhas(id) ON DELETE CASCADE,
      numero       VARCHAR(20)  NOT NULL,
      variaveis    JSONB        DEFAULT '{}',
      status       VARCHAR(20)  DEFAULT 'pendente',
      tentativas   INTEGER      DEFAULT 0,
      enviado_em   TIMESTAMPTZ,
      erro_msg     TEXT,
      UNIQUE(campanha_id, numero)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id        SERIAL PRIMARY KEY,
      numero    VARCHAR(20) UNIQUE NOT NULL,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Índices para melhor performance
  await query(`CREATE INDEX IF NOT EXISTS idx_contatos_campanha_status ON contatos(campanha_id, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_campanhas_status ON campanhas(status)`);

  console.log('[DB] Tabelas inicializadas com sucesso.');
}

module.exports = { query, initDB };
