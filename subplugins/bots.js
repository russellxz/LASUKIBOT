// subplugins/bots.js — Comando global: ver subbots conectados, su tiempo
// activo, sus prefijos actuales y el dispositivo vinculado
import { listSubbots, formatUptime, formatPlatform } from "../subbots.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, { react: { text: "🤖", key: msg.key } }).catch(() => {});

  const bots = listSubbots();
  const conectados = bots.filter((b) => b.connected);

  if (!conectados.length) {
    return conn.sendMessage(
      chatId,
      { text: "🤖 No hay subbots conectados por ahora.\nUsa *code +tunúmero* para conectarte al sistema de subbots." },
      { quoted: msg }
    );
  }

  let texto = `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

🤖 *Total de subbots conectados:* ${conectados.length}

`.trim() + "\n\n";

  let i = 1;
  for (const b of conectados) {
    const tiempo = b.connectedSince ? formatUptime(Date.now() - b.connectedSince) : "—";
    const prefijos = (Array.isArray(b.prefixes) && b.prefixes.length ? b.prefixes : ["."]).join("  ");
    const dispositivo = formatPlatform(b.platform);
    texto += `${i}. 👤 *${b.name}*\n   ⏱️ ${tiempo} • 📲 ${dispositivo}\n   🔣 Prefijos: ${prefijos}\n\n`;
    i++;
  }

  texto = texto.trimEnd() + "\n\n━━━━━━━━━━━━━━━━━━\n🤖 *Suki Subbots*";

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["bots"];
export default handler;
