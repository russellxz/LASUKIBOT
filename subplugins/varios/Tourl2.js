// plugins/tourl2.js — Upload con extensión por mimetype + WA inyectado
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/upload.php"; // .php requerido
const API_KEY = "russellxzomega";

// ————— Helpers —————
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}
function collectContextInfos(msg) {
  const m = unwrapMessage(msg?.message) || {};
  const ctxs = [];
  const nodes = [
    m.extendedTextMessage, m.imageMessage, m.videoMessage,
    m.documentMessage, m.audioMessage, m.stickerMessage,
    m.buttonsMessage, m.templateMessage
  ];
  for (const n of nodes) if (n?.contextInfo) ctxs.push(n.contextInfo);
  return ctxs;
}
function getQuotedMessage(msg) {
  for (const c of collectContextInfos(msg)) {
    if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  }
  return null;
}
function findMediaNode(messageLike) {
  const m = unwrapMessage(messageLike) || {};
  const order = [
    ["documentMessage", "document"],
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["stickerMessage", "sticker"],
  ];
  for (const [k, t] of order) if (m[k]) return { type: t, content: m[k] };
  return null;
}
function ensureWA(wa, conn) {
  if (wa?.downloadContentFromMessage) return wa;
  if (conn?.wa?.downloadContentFromMessage) return conn.wa;
  if (global.wa?.downloadContentFromMessage) return global.wa;
  return null;
}
async function downloadToBuffer(WA, type, content) {
  const stream = await WA.downloadContentFromMessage(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}
function extFromMime(m) {
  if (!m) return null;
  m = String(m).toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.android.package-archive": "apk",
  };
  return map[m] || null;
}
function ensureExt(filename, contentType, isSticker = false) {
  const name = String(filename || "archivo");
  const hasExt = /\.[^.]+$/.test(name);
  if (hasExt) return name;
  let ext = extFromMime(contentType);
  if (!ext && isSticker) ext = "webp";
  if (!ext) ext = "bin";
  return `${name}.${ext}`;
}

// ————— Handler —————
const handler = async (msg, { conn, args, wa, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  const WA = ensureWA(wa, conn);
  if (!WA) {
    await conn.sendMessage(chatId, { text: "❌ No pude acceder a Baileys (wa no inyectado).", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  let target = getQuotedMessage(msg) || msg.message;
  let media = findMediaNode(target);

  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let contentType = "application/octet-stream";

  try {
    if (media) {
      filename = media.content?.fileName || media.content?.fileNameWithExt || media.content?.fileNameWithExtension || filename;
      contentType = media.content?.mimetype || contentType;
      buffer = await downloadToBuffer(WA, media.type === "sticker" ? "sticker" : media.type, media.content);
      filename = ensureExt(filename, contentType, media.type === "sticker");
    }
  } catch (e) {
    console.error("[tourl2] error descargando media:", e);
  }

  // Fallback: URL en args[0]
  if (!buffer) {
    const maybeUrl = args && args[0] ? String(args[0]).trim() : null;
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      try {
        const r = await fetch(maybeUrl, { timeout: 120000 });
        if (!r.ok) throw new Error(`No se pudo descargar la URL (HTTP ${r.status})`);
        buffer = await r.buffer();
        contentType = r.headers.get("content-type") || contentType;
        const u = new URL(maybeUrl);
        let base = path.basename(u.pathname) || "archivo";
        if (!/\.[^.]+$/.test(base)) base = `${base}.${extFromMime(contentType) || "bin"}`;
        filename = base;
      } catch (e) {
        await conn.sendMessage(chatId, { text: `❌ No encontré archivo ni pude descargar la URL:\n${e.message}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, {
        text: `✳️ *Usa:* ${pref}${command || "tourl2"}\nResponde un *archivo* (imagen/video/audio/sticker/documento) o pasa una *URL*.`,
        quoted: msg
      });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return;
    }
  }

  if (!buffer || buffer.length === 0) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo leer el archivo.", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // Límite 200 MB
  if (buffer.length > 200 * 1024 * 1024) {
    await conn.sendMessage(chatId, { text: "⚠️ Archivo demasiado grande (máx. 200 MB).", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // Subir
  const form = new FormData();
  form.append("file", buffer, { filename, contentType }); // filename con extensión garantizada
  form.append("name", filename.replace(/\.[^.]+$/, "").slice(0, 120));
  form.append("uploader", (msg.key.participant || msg.key.remoteJid || "").replace(/\D/g, ""));

  let resp, text;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": API_KEY, ...form.getHeaders() },
      body: form,
      timeout: 120000,
    });
    text = await resp.text();
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error al subir: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok || json?.ok === false) {
    const err = (json && (json.error || json.hint || json.raw)) || `HTTP ${resp.status}`;
    await conn.sendMessage(chatId, { text: `❌ Upload falló: ${err}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  const url =
    json?.file?.url || json?.url || json?.data?.url || json?.result?.url || null;

  if (!url) {
    await conn.sendMessage(chatId, {
      text: `✅ Subido, pero sin URL en la respuesta:\n\`\`\`${text}\`\`\``,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
    return;
  }

  await conn.sendMessage(chatId, { text: `✅ Archivo subido:\n${url}`, quoted: msg });
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

handler.command = ["tourl2", "tourl"];
handler.help = ["tourl2 (o tourl) — responde a un media o pasa URL"];
handler.tags = ["herramientas"];
handler.register = true;

export default handler;
