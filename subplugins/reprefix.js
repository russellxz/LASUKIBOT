// subplugins/reprefix.js — Restablece los prefijos de fábrica del subbot (. # /)
// Funciona SIEMPRE con . # / aunque el subbot tenga otro prefijo configurado,
// por si el dueño olvidó cuál puso (el pipeline lo rescata aparte).
import { DEFAULT_SUB_PREFIXES } from "../subbots.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const fromMe = msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }).catch(() => {});

  // 🚫 Solo el mismo subbot puede restablecer su prefijo
  if (!fromMe) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede restablecer el prefijo."
    }, { quoted: msg });
  }

  const anteriores = Array.isArray(conn.subPrefixes) ? [...conn.subPrefixes] : [];
  const defaults = [...DEFAULT_SUB_PREFIXES];

  // Guardar en el config.json propio del subbot
  const cfg = conn.readSubData("config.json", {});
  cfg.prefixes = defaults;
  conn.writeSubData("config.json", cfg);
  conn.subPrefixes = defaults;

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});

  return conn.sendMessage(chatId, {
    text: `✅ *Prefijos restablecidos de fábrica.*

${anteriores.length ? `📤 Antes: ${anteriores.join("  ")}\n` : ""}📥 Ahora: ${defaults.join("  ")}

💡 Puedes volver a personalizarlos con *${defaults[0]}setprefix*.`
  }, { quoted: msg });
};

handler.command = ["reprefix", "resetprefix"];
export default handler;
