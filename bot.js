'use strict';
const waha     = require('./waha');
const { query } = require('./models/db');
const { parseCSV } = require('./csv');
const {
    agendarCampanha,
    pausarCampanha,
    retomarCampanha,
    cancelarCampanha,
    statusCampanha,
} = require('./queue');
// Estado em memória por número (aguardando mensagem ou csv)
const estadoUsuario = {};

/**
 * Ponto de entrada principal: processa cada webhook do WAHA
 */
async function processarMensagem(payload) {
    try {
          const evento = payload.event;

      // Só processa eventos de mensagem recebida
      if (evento !== 'message' && evento !== 'message.any') return;

      const msg    = payload.payload;
          const chatId = msg?.from || msg?.chatId;
          if (!chatId) return;

      // Se for grupo, ignora
      if (chatId.endsWith('@g.us')) return;

      const sessionInfo = await waha.getSessionInfo().catch(() => null);
          const meId = sessionInfo?.me?.id || '';

      const remetenteNumero = chatId.replace(/@.*$/, '');
                  const meuNumero       = meId.replace(/@.*$/, '') || process.env.OWNER_NUMBER || '';    console.log(`[BOT] chatId=${chatId} fromMe=${msg?.fromMe} remetente=${remetenteNumero} meu=${meuNumero}`);

      // Ignorar mensagens enviadas pelo bot para outros números
      // No self-chat (dono envia para si mesmo) fromMe=true mas devemos processar
      const isSelfChat = remetenteNumero === meuNumero;
          if (msg?.fromMe && !isSelfChat) return;

      // Ignorar as respostas automáticas do bot (fromMe + começa com emoji do bot)
      const texto = (msg?.body || '').trim();
          if (msg?.fromMe && isSelfChat) {
                  const botPrefixes = ['🤖', '✅', '❌', '🚀', '⏸', '▶️', '🛑', '📋', '📊', '⚠️', '⏰', '🛡'];
                  if (botPrefixes.some(p => texto.startsWith(p))) return;
          }

      const tipo  = msg?.type || 'chat';

      // ── Verificar STOP para blacklist ────────────────────────────────────────
      if (texto.toUpperCase() === 'STOP') {
              await query(
                        `INSERT INTO blacklist(numero) VALUES($1) ON CONFLICT(numero) DO NOTHING`,
                        [remetenteNumero]
                      );
              await waha.sendText(remetenteNumero, '✅ Seu número foi adicionado à lista de exclusão. Você não receberá mais mensagens.');
              return;
      }

      // ── Só processa comandos vindos do próprio dono (self-chat) ──────────────
      if (remetenteNumero !== meuNumero) {
              // Mensagem de outro número — apenas verifica STOP (já feito acima)
            return;
      }

      // ── Processar arquivo CSV ────────────────────────────────────────────────
      if (tipo === 'document' || tipo === 'file') {
              await processarArquivoCSV(remetenteNumero, msg);
              return;
      }

      // ── Comandos de texto ────────────────────────────────────────────────────
      const cmd = texto.toUpperCase();

      switch (cmd) {
        case 'INICIAR':
                  await cmdIniciar(remetenteNumero);
                  break;
        case 'PAUSAR':
                  await cmdPausar(remetenteNumero);
                  break;
        case 'RETOMAR':
                  await cmdRetomar(remetenteNumero);
                  break;
        case 'CANCELAR':
                  await cmdCancelar(remetenteNumero);
                  break;
        case 'STATUS':
                  await cmdStatus(remetenteNumero);
                  break;
        case 'AJUDA':
                  await cmdAjuda(remetenteNumero);
                  break;
        default:
                  await cmdSalvarMensagem(remetenteNumero, texto);
      }
    } catch (err) {
          console.error('[BOT] Erro ao processar mensagem:', err.message);
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function cmdSalvarMensagem(numero, texto) {
    if (!texto || texto.length < 3) {
          await waha.sendText(numero, '❌ Mensagem muito curta. Digite o texto do disparo com variáveis como {{nome}} e {{empresa}}.');
          return;
    }

  // Cancela qualquer campanha em aberto no estado de aguardando mensagem
  const estado = estadoUsuario[numero];
    if (estado && estado.fase === 'aguardando_csv') {
          await waha.sendText(numero, '⚠️ Você tinha um CSV pendente. Descartando e reiniciando com nova mensagem.');
    }

  // Cria nova campanha
  const res = await query(
        `INSERT INTO campanhas(status, mensagem) VALUES('aguardando_csv', $1) RETURNING id`,
        [texto]
      );
    const campanhaId = res.rows[0].id;
    estadoUsuario[numero] = { fase: 'aguardando_csv', campanhaId };

  await waha.sendText(
        numero,
        `✅ *Mensagem salva!*\n\nPreview:\n_${texto.substring(0, 200)}_\n\nAgora envie o arquivo *.csv* com os contatos.\nColunas obrigatórias: *numero* e *nome*.\nColunas extras viram variáveis automáticas.`
      );
}

async function processarArquivoCSV(numero, msg) {
    const estado = estadoUsuario[numero];
    if (!estado || estado.fase !== 'aguardando_csv') {
          await waha.sendText(numero, '❌ Primeiro envie a mensagem de texto do disparo antes do CSV.');
          return;
    }

  // O arquivo CSV vem como base64 no payload do WAHA
  let csvBuffer;
    try {
          const base64 = msg?.media?.data || msg?.body;
          if (!base64) throw new Error('Arquivo não encontrado no payload.');
          csvBuffer = Buffer.from(base64, 'base64');
    } catch (e) {
          await waha.sendText(numero, `❌ Não consegui ler o arquivo: ${e.message}`);
          return;
    }

  let contatos;
    try {
          contatos = parseCSV(csvBuffer);
    } catch (e) {
          await waha.sendText(numero, `❌ Erro no CSV: ${e.message}`);
          return;
    }

  if (!contatos.length) {
        await waha.sendText(numero, '❌ O CSV não possui contatos válidos.');
        return;
  }

  const { campanhaId } = estado;

  // Salva contatos no banco
  for (const c of contatos) {
        await query(
                `INSERT INTO contatos(campanha_id, numero, variaveis) VALUES($1, $2, $3)`,
                [campanhaId, c.numero, JSON.stringify(c.variaveis)]
              );
  }

  await query(
        `UPDATE campanhas SET total=$1, status='aguardando_confirmacao' WHERE id=$2`,
        [contatos.length, campanhaId]
      );

  estadoUsuario[numero] = { ...estado, fase: 'aguardando_confirmacao' };

  await waha.sendText(
        numero,
        `📋 *CSV recebido com ${contatos.length} contatos!*\n\nCampanha pronta.\nResponda *INICIAR* para começar ou *CANCELAR* para descartar.`
      );
}

async function cmdIniciar(numero) {
    const estado = estadoUsuario[numero];
    if (!estado || estado.fase !== 'aguardando_confirmacao') {
          await waha.sendText(numero, '❌ Não há campanha pronta para iniciar. Envie a mensagem e o CSV primeiro.');
          return;
    }

  const { campanhaId } = estado;
    await query(`UPDATE campanhas SET status='ativa', iniciada_em=NOW() WHERE id=$1`, [campanhaId]);
    estadoUsuario[numero] = { ...estado, fase: 'em_andamento' };

  await waha.sendText(numero, `🚀 *Campanha iniciada!* Você receberá atualizações de progresso aqui.`);
    await agendarCampanha(campanhaId);
}

async function cmdPausar(numero) {
    const camp = await statusCampanha();
    if (!camp || camp.status !== 'ativa') {
          await waha.sendText(numero, '❌ Não há campanha ativa no momento.');
          return;
    }
    await pausarCampanha(camp.id);
    await waha.sendText(numero, `⏸ *Campanha pausada.*\nEnviadas até agora: ${camp.enviadas}/${camp.total}\nResponda *RETOMAR* para continuar.`);
}

async function cmdRetomar(numero) {
    const camp = await statusCampanha();
    if (!camp || camp.status !== 'pausada') {
          await waha.sendText(numero, '❌ Não há campanha pausada.');
          return;
    }
    await retomarCampanha(camp.id);
    await waha.sendText(numero, `▶️ *Campanha retomada!* Continuando de onde parou.`);
}

async function cmdCancelar(numero) {
    const estado = estadoUsuario[numero];
    const camp   = await statusCampanha();

  let campanhaId = estado?.campanhaId || camp?.id;
    if (!campanhaId) {
          await waha.sendText(numero, '❌ Não há campanha ativa para cancelar.');
          return;
    }

  await cancelarCampanha(campanhaId);
    estadoUsuario[numero] = null;
    await waha.sendText(numero, `🛑 *Campanha cancelada.* Todos os contatos pendentes foram descartados.`);
}

async function cmdStatus(numero) {
    const camp = await statusCampanha();
    if (!camp) {
          await waha.sendText(numero, '📊 Nenhuma campanha ativa no momento.\nEnvie uma mensagem de texto para iniciar um novo disparo.');
          return;
    }
    const pendentes = camp.total - camp.enviadas;
    const icone = { ativa: '🟢', pausada: '🟡', finalizada: '✅', cancelada: '🔴' }[camp.status] || '⚪';
    await waha.sendText(
          numero,
          `${icone} *Status da Campanha #${camp.id}*\n\n📊 Total: ${camp.total}\n✓ Enviadas: ${camp.enviadas - camp.erros}\n✗ Erros: ${camp.erros}\n⏳ Pendentes: ${pendentes}\n📌 Status: ${camp.status}`
        );
}

async function cmdAjuda(numero) {
    await waha.sendText(
          numero,
          `🤖 *Bot de Disparos — Comandos Disponíveis*\n\n` +
          `Para iniciar um disparo:\n` +
          `1️⃣ Envie o *texto da mensagem* com variáveis como {{nome}}\n` +
          `2️⃣ Envie o arquivo *.csv* com colunas: numero, nome (+ extras)\n` +
          `3️⃣ Responda *INICIAR*\n\n` +
          `Comandos:\n` +
          `• *INICIAR* — Inicia a campanha pronta\n` +
          `• *PAUSAR* — Pausa o disparo em andamento\n` +
          `• *RETOMAR* — Retoma campanha pausada\n` +
          `• *CANCELAR* — Cancela e descarta pendentes\n` +
          `• *STATUS* — Resumo da campanha atual\n` +
          `• *AJUDA* — Exibe esta mensagem\n\n` +
          `⏰ Envios: seg–sex, ${process.env.ENVIO_HORA_INICIO || 9}h–${process.env.ENVIO_HORA_FIM || 18}h (BRT)\n` +
          `🛡 Anti-banimento ativo: intervalos aleatórios + limites diários`
        );
}

module.exports = { processarMensagem };
