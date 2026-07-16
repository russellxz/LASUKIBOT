// plugins/guars.js
// Guarda stickers en un paquete. Si se responde a un StickerPackMessage,
// guarda TODOS los stickers del paquete de una sola vez.
// Uso: .guars <nombre_del_paquete>

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PACKS_ROOT = path.resolve("./guars_media");
const PACKS_DB = path.resolve("./guars_packs.json");

function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

function sanitizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64) || "default";
}

async function streamToBuffer(stream) {
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

const handler = async (msg, { conn, args, wa }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const userId = String(sender || "").replace(/[^0-9]/g, "");
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ *Error:* Debes *responder* a un sticker o a un paquete de stickers con *${pref}guarsk <nombre>*.`,
    }, { quoted: msg });
  }

  const packName = (args || []).join(" ").trim().toLowerCase();
  if (!packName || !/[a-z0-9]/i.test(packName)) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ *Error:* Debes indicar un *nombre* para el paquete.\nEjemplo: *${pref}guarsk memes*`,
    }, { quoted: msg });
  }

  const WA = ensureWA(wa, conn);
  if (!WA) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: "❌ *Error interno:* downloader no disponible.",
    }, { quoted: msg });
  }

  // ====== Detectar si es sticker individual o paquete de stickers ======
  let nodesToSave = []; // array de { node, emojis }

  if (quoted.stickerMessage) {
    nodesToSave.push({ node: quoted.stickerMessage, emojis: [] });
  } else if (quoted.stickerPackMessage) {
    // Es un paquete nativo de stickers — extraemos todos
    const packMsg = quoted.stickerPackMessage;
    const stickersList = packMsg.stickers || [];

    if (!stickersList.length) {
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return conn.sendMessage(chatId, {
        text: `❌ El paquete de stickers está vacío.`,
      }, { quoted: msg });
    }

    // Cada sticker dentro del pack tiene su propio mediaKey, directPath, etc.
    for (const st of stickersList) {
      nodesToSave.push({
        node: {
          mediaKey: st.mediaKey,
          directPath: st.directPath,
          fileSha256: st.fileSha256,
          fileEncSha256: st.fileEncSha256,
          mimetype: st.mimetype || "image/webp",
          url: st.url,
          fileLength: st.fileLength,
        },
        emojis: Array.isArray(st.emojis) ? st.emojis : [],
      });
    }
  } else {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ *Error:* Solo se aceptan *stickers* o *paquetes de stickers*.`,
    }, { quoted: msg });
  }

  // ====== Preparar carpetas y DB ======
  if (!fs.existsSync(PACKS_ROOT)) fs.mkdirSync(PACKS_ROOT, { recursive: true });
  const safeKey = sanitizeKey(packName);
  const packDir = path.join(PACKS_ROOT, safeKey);
  if (!fs.existsSync(packDir)) fs.mkdirSync(packDir, { recursive: true });

  let db = {};
  if (fs.existsSync(PACKS_DB)) {
    try { db = JSON.parse(fs.readFileSync(PACKS_DB, "utf-8")); } catch { db = {}; }
  }
  if (!db[packName]) {
    db[packName] = {
      name: packName,
      createdBy: userId,
      createdAt: Date.now(),
      stickers: [],
    };
  }

  // ====== Descargar y guardar cada sticker ======
  let guardados = 0;
  let errores = 0;

  for (const { node, emojis } of nodesToSave) {
    try {
      const stream = await WA.downloadContentFromMessage(node, "sticker");
      const buf = await streamToBuffer(stream);
      if (!buf.length) { errores++; continue; }

      const timestamp = Date.now() + guardados;
      const randomId = crypto.randomBytes(4).toString("hex");
      const fileName = `${timestamp}_${randomId}.webp`;
      const filePath = path.join(packDir, fileName);
      const relativePath = path.relative(process.cwd(), filePath).split(path.sep).join("/");

      fs.writeFileSync(filePath, buf);

      db[packName].stickers.push({
        path: relativePath,
        fileName,
        emojis,
        size: buf.length,
        addedBy: userId,
        addedAt: timestamp,
      });

      guardados++;
    } catch (e) {
      console.error("[guars] error:", e);
      errores++;
    }
  }

  // Guardar DB
  try {
    fs.writeFileSync(PACKS_DB, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("[guars] error guardando DB:", e);
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ Error al guardar la base de datos: \`${e.message}\``,
    }, { quoted: msg });
  }

  if (guardados === 0) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ No se pudo guardar ningún sticker.`,
    }, { quoted: msg });
  }

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}

  const total = db[packName].stickers.length;
  let texto = `✅ *Paquete actualizado:* *${packName}*\n`;
  texto += `• Stickers guardados ahora: *${guardados}*\n`;
  if (errores > 0) texto += `• Errores: *${errores}*\n`;
  texto += `• Total en el paquete: *${total}*\n\n`;
  texto += `📤 Envíalo con: *${pref}sendsk ${packName}*`;

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["guarsk"];
export default handler;
