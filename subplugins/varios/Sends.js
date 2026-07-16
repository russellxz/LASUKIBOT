// plugins/sends.js
// Envía un paquete de stickers guardado como paquete NATIVO de WhatsApp
// (la tarjeta con botón "Ver paquete de stickers").
// Uso: .sends <nombre_del_paquete>

import fs from 'fs';
import path from 'path';

const PACKS_DB = path.resolve("./guars_packs.json");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  try { await conn.sendMessage(chatId, { react: { text: "📤", key: msg.key } }); } catch {}

  const packName = (args || []).join(" ").trim().toLowerCase();
  if (!packName) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❗ Uso: *${pref}sends <nombre_del_paquete>*\nEjemplo: *${pref}sendsk memes*`,
    }, { quoted: msg });
  }

  if (!fs.existsSync(PACKS_DB)) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `⚠️ No hay paquetes guardados aún. Usa *${pref}guarsk <nombre>* primero.`,
    }, { quoted: msg });
  }

  let db = {};
  try {
    db = JSON.parse(fs.readFileSync(PACKS_DB, "utf-8"));
  } catch (e) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ Error al leer la base de datos: \`${e.message}\``,
    }, { quoted: msg });
  }

  const pack = db[packName];
  if (!pack || !Array.isArray(pack.stickers) || pack.stickers.length === 0) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `⚠️ El paquete *"${packName}"* no existe o está vacío.`,
    }, { quoted: msg });
  }

  // Preparar lista de stickers con buffers
  const stickers = [];
  const stickersFaltantes = [];

  for (const st of pack.stickers) {
    try {
      const filePath = path.resolve(st.path);
      if (fs.existsSync(filePath)) {
        stickers.push({
          data: { url: filePath },
          emojis: st.emojis && st.emojis.length ? st.emojis : ["🎨"],
        });
      } else {
        stickersFaltantes.push(st.fileName);
      }
    } catch (e) {
      stickersFaltantes.push(st.fileName || "desconocido");
    }
  }

  if (stickers.length === 0) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ No se encontró ningún archivo físico del paquete *"${packName}"*.`,
    }, { quoted: msg });
  }

  // ====== Enviar como paquete nativo de stickers ======
  // El primer sticker se usa también como "cover" (portada)
  try {
    await conn.sendMessage(chatId, {
      cover: stickers[0].data,
      stickers: stickers,
      name: packName,
      publisher: "SkyUltraPlus Bot",
      description: `Paquete con ${stickers.length} sticker${stickers.length !== 1 ? "s" : ""}`,
    }, { quoted: msg });

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}

    if (stickersFaltantes.length > 0) {
      return conn.sendMessage(chatId, {
        text: `⚠️ Se enviaron *${stickers.length}* stickers, pero *${stickersFaltantes.length}* archivo(s) no se encontraron en disco.`,
      }, { quoted: msg });
    }
  } catch (e) {
    console.error("[sends] error enviando paquete nativo:", e);

    // Fallback: enviar uno por uno si el envío nativo falla
    try {
      for (const st of stickers) {
        await conn.sendMessage(chatId, {
          sticker: { url: st.data.url },
        }, { quoted: msg });
      }
      try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
      return conn.sendMessage(chatId, {
        text: `ℹ️ Tu versión de Baileys no soporta paquetes nativos, envié los *${stickers.length}* stickers uno por uno.`,
      }, { quoted: msg });
    } catch (e2) {
      console.error("[sends] error en fallback:", e2);
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return conn.sendMessage(chatId, {
        text: `❌ Error al enviar el paquete: \`${e.message}\``,
      }, { quoted: msg });
    }
  }
};

handler.command = ["sendsk"];
export default handler;
