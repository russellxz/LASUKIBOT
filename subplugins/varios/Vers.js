// plugins/vers.js
// Muestra la lista de paquetes de stickers guardados con .guars
// Uso: .vers

import fs from 'fs';
import path from 'path';

const PACKS_DB = path.resolve("./guars_packs.json");

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "🎨", key: msg.key } });

  // ====== Verificar que exista el archivo ======
  if (!fs.existsSync(PACKS_DB)) {
    return conn.sendMessage(chatId, {
      text: `📂 *Lista vacía:* No hay paquetes de stickers guardados.\nUsa *${pref}guarsk <nombre>* respondiendo a un sticker para guardar.`,
    }, { quoted: msg });
  }

  let db = {};
  try {
    db = JSON.parse(fs.readFileSync(PACKS_DB, "utf-8"));
  } catch (e) {
    return conn.sendMessage(chatId, {
      text: `❌ Error al leer la base de datos: \`${e.message}\``,
    }, { quoted: msg });
  }

  // ====== Limpiar paquetes vacíos ======
  let cambios = false;
  for (const key in db) {
    const pack = db[key];
    if (!pack || !Array.isArray(pack.stickers) || pack.stickers.length === 0) {
      delete db[key];
      cambios = true;
    }
  }
  if (cambios) {
    try { fs.writeFileSync(PACKS_DB, JSON.stringify(db, null, 2)); } catch {}
  }

  const claves = Object.keys(db);
  if (claves.length === 0) {
    return conn.sendMessage(chatId, {
      text: `📂 *Lista vacía:* No hay paquetes de stickers con contenido.`,
    }, { quoted: msg });
  }

  // ====== Armar el texto ======
  const clavesOrdenadas = claves.sort();
  const mentions = [];
  let totalStickers = 0;

  let texto = `🎨 *Lista de paquetes de stickers:*\n\n`;

  for (const key of clavesOrdenadas) {
    const pack = db[key];
    const stickers = pack.stickers || [];
    if (stickers.length === 0) continue;

    totalStickers += stickers.length;

    texto += `📦 *${key}* (${stickers.length} sticker${stickers.length !== 1 ? "s" : ""}):\n`;

    stickers.forEach((st, i) => {
      const userId = st.addedBy || pack.createdBy;
      const num = userId ? String(userId).replace(/[^0-9]/g, "") : null;
      const jid = num ? `${num}@s.whatsapp.net` : null;
      if (jid && !mentions.includes(jid)) mentions.push(jid);

      // Mostrar los emojis asociados si existen
      const emojis = Array.isArray(st.emojis) && st.emojis.length
        ? st.emojis.join("")
        : "🎨";

      texto += `   ${i + 1}. ${emojis} — Agregado por: ${jid ? `@${num}` : "🤷‍♂️ Desconocido"}\n`;
    });

    texto += `\n`;
  }

  // Footer con info útil
  texto += `━━━━━━━━━━━━━━━\n`;
  texto += `📊 *Total:* ${clavesOrdenadas.length} paquete${clavesOrdenadas.length !== 1 ? "s" : ""} · ${totalStickers} sticker${totalStickers !== 1 ? "s" : ""}\n\n`;
  texto += `📤 Enviar paquete: *${pref}sendsk <nombre>*\n`;
  texto += `🗑️ Eliminar sticker: *${pref}delsk <paquete> <número>*`;

  return conn.sendMessage(chatId, {
    text: texto.trim(),
    mentions,
  }, { quoted: msg });
};

handler.command = ["versk"];
export default handler;
