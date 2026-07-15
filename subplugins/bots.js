// subplugins/bots.js — Comando global: ver subbots conectados y su tiempo activo
import { listSubbots, formatUptime } from "../subbots.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, { react: { text: "🤖", key: msg.key } }).catch(() => {});

  const bots = listSubbots();
  const conectados = bots.filter((b) => b.connected);

  if (!bots.length) {
    return conn.sendMessage(
      chatId,
      { text: "🤖 No hay subbots vinculados por ahora.\nUsa *code +tunúmero* para conectarte al sistema de subbots." },
      { quoted: msg }
    );
  }

  let texto = `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

🤖 *Subbots conectados:* ${conectados.length}/${bots.length}

`.trim() + "\n\n";

  let i = 1;
  for (const b of bots) {
    const estado = b.connected ? "🟢 Activo" : "🔴 Reconectando";
    const tiempo = b.connectedSince ? formatUptime(Date.now() - b.connectedSince) : "—";
    texto += `${i}. wa.me/${b.number}\n   ${estado} • ⏱️ ${tiempo}\n`;
    i++;
  }

  texto += "\n━━━━━━━━━━━━━━━━━━\n🤖 *Suki Subbots*";

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["bots"];
export default handler;
