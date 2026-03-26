const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env['DATA' + 'BASE_URL'], ssl: { rejectUnauthorized: false } });

async function inicializarDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campanhas (
      id SERIAL PRIMARY KEY,
      texto TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'aguardando_csv',
      total INTEGER DEFAULT 0,
      enviadas INTEGER DEFAULT 0,
      erros INTEGER DEFAULT 0,
      criada_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      campanha_id INTEGER REFERENCES campanhas(id),
      numero VARCHAR(20) NOT NULL,
      nome VARCHAR(100),
      extras JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pendente',
      erro TEXT
    );
    CREATE TABLE IF NOT EXISTS blacklist (
      numero VARCHAR(20) PRIMARY KEY,
      adicionado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('[DB] Tabelas inicializadas com sucesso.');
}

module.exports = { pool, inicializarDB };
