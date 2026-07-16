import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const groupId = msg.key.remoteJid;
  const isGroup = groupId.endsWith("@g.us");
  const KISS_PATH = path.resolve("kiss_data.json");

  if (!isGroup) {
    return conn.sendMessage(groupId, {
      text: "⚠️ Este comando solo funciona en grupos."
    }, { quoted: msg });
  }

  // Reacción inicial
  await conn.sendMessage(groupId, {
    react: { text: "💋", key: msg.key }
  });

  if (!fs.existsSync(KISS_PATH)) {
    return conn.sendMessage(groupId, {
      text: "📭 No hay datos de besos todavía en este grupo."
    }, { quoted: msg });
  }

  const data = JSON.parse(fs.readFileSync(KISS_PATH));
  const grupo = data[groupId];
  if (!grupo) {
    return conn.sendMessage(groupId, {
      text: "📭 Este grupo aún no tiene besos registrados."
    }, { quoted: msg });
  }

  const mentions = [];
  const besosDados = Object.entries(grupo.besosDados || {}).map(([id, info]) => ({
    id,
    total: info.total
  })).sort((a, b) => b.total - a.total).slice(0, 5);

  const besosRecibidos = Object.entries(grupo.besosRecibidos || {}).map(([id, info]) => ({
    id,
    total: info.total
  })).sort((a, b) => b.total - a.total).slice(0, 5);

  const topBesadores = besosDados.map((user, i) => {
    const tag = `@${user.id}`;
    mentions.push(`${user.id}@s.whatsapp.net`);
    return `🎯 ${i + 1}. ${tag} — ${user.total} 💋`;
  }).join("\n");

  const topBesados = besosRecibidos.map((user, i) => {
    const tag = `@${user.id}`;
    mentions.push(`${user.id}@s.whatsapp.net`);
    return `❤️ ${i + 1}. ${tag} — ${user.total} 😘`;
  }).join("\n");

  const text = `╭〔 *TOP KISS DEL GRUPO* 〕╮

👄 *Usuarios que MÁS besaron:*
${topBesadores || "— Sin datos —"}

──────────────────

💗 *Usuarios MÁS besados:*
${topBesados || "— Sin datos —"}

╰─────────────────╯`;

  await conn.sendMessage(groupId, {
    text,
    mentions
  }, { quoted: msg });
};

handler.command = ["topkiss"];
export default handler;
