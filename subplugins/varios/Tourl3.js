// plugins/tourl3.js — ToURL via tu API (/cdn/tourl) usando apikey Russellxz
"use strict";

import path from 'path';
import fetch from 'node-fetch';

// ==== CONFIG ====
const API_BASE = "https://api-sky.ultraplus.click"; // <-- CAMBIA ESTO (ej: https://dash.skyultraplus.com)
const API_KEY = "Russellxz";

// Endpoints de tu API (los que hiciste)
const ENDPOINT_JSON = "/cdn/tourl";       // POST { url } o { data_base64... }
const ENDPOINT_RAW  = "/cdn/tourl/raw";   // POST binario ?filename=...

// ————— Helpers WA (igual tu tourl2) —————
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
    m.extendedTextMessage,
    m.imageMessage,
    m.videoMessage,
    m.documentMessage,
    m.audioMessage,
    m.stickerMessage,
    m.buttonsMessage,
    m.templateMessage,
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

function safeFilename(name) {
  let n = String(name || "upload").slice(0, 120);
  n = n.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return n || "upload";
}

function pickUrlFromApi(json) {
  // tu endpoint devuelve: { status:true, result:{ url, ... } }
  const u =
    json?.result?.url ||
    json?.url ||
    json?.file?.url ||
    json?.data?.url ||
    json?.result?.data?.url ||
    null;
  return u;
}

// ————— Subidas via tu API —————
async function apiUploadRaw({ buffer, filename, mime }) {
  const base = API_BASE.replace(/\/+$/, "");
  const safe = safeFilename(filename || `upload_${Date.now()}`);
  const url = `${base}${ENDPOINT_RAW}?filename=${encodeURIComponent(safe)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: API_KEY,
      "Content-Type": mime || "application/octet-stream",
    },
    body: buffer,
    timeout: 120000,
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { status: false, message: "Respuesta no JSON", raw: text }; }

  if (!r.ok || json?.status === false) {
    const err = json?.message || json?.raw || `HTTP ${r.status}`;
    throw new Error(err);
  }

  return json;
}

async function apiUploadFromUrl(remoteUrl) {
  const base = API_BASE.replace(/\/+$/, "");
  const url = `${base}${ENDPOINT_JSON}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: remoteUrl }),
    timeout: 120000,
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { status: false, message: "Respuesta no JSON", raw: text }; }

  if (!r.ok || json?.status === false) {
    const err = json?.message || json?.raw || `HTTP ${r.status}`;
    throw new Error(err);
  }

  return json;
}

// ————— Handler —————
const handler = async (msg, { conn, args, wa, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  // Validación rápida del API_BASE
  if (!/^https?:\/\//i.test(API_BASE)) {
    await conn.sendMessage(chatId, { text: "❌ Config inválida: pon un API_BASE con https://...", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  const WA = ensureWA(wa, conn);

  // 1) Intentar media (responder a archivo) si existe WA
  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let mime = "application/octet-stream";

  if (WA) {
    try {
      const target = getQuotedMessage(msg) || msg.message;
      const media = findMediaNode(target);
      if (media) {
        filename =
          media.content?.fileName ||
          media.content?.fileNameWithExt ||
          media.content?.fileNameWithExtension ||
          filename;

        mime = media.content?.mimetype || mime;

        buffer = await downloadToBuffer(
          WA,
          media.type === "sticker" ? "sticker" : media.type,
          media.content
        );

        filename = ensureExt(filename, mime, media.type === "sticker");
      }
    } catch (e) {
      console.error("[tourl3] error descargando media:", e);
    }
  }

  // 2) Fallback: URL en args
  const maybeUrl = args && args[0] ? String(args[0]).trim() : null;

  if (!buffer) {
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      try {
        const apiRes = await apiUploadFromUrl(maybeUrl);
        const url = pickUrlFromApi(apiRes);

        if (!url) throw new Error("Subió pero no vino URL en respuesta");

        await conn.sendMessage(chatId, { text: `✅ Subido (URL):\n${url}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
        return;
      } catch (e) {
        await conn.sendMessage(chatId, { text: `❌ Error subiendo URL:\n${e.message}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
        return;
      }
    }

    await conn.sendMessage(chatId, {
      text: `✳️ *Usa:* ${pref}${command || "tourl3"}\nResponde un *archivo* (imagen/video/audio/sticker/documento) o pasa una *URL*.\n\nEj:\n- Responde una foto y escribe: ${pref}${command || "tourl3"}\n- ${pref}${command || "tourl3"} https://site.com/archivo.mp4`,
      quoted: msg,
    });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  if (!buffer || buffer.length === 0) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo leer el archivo.", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // Límite 200MB (igual tu endpoint)
  if (buffer.length > 200 * 1024 * 1024) {
    await conn.sendMessage(chatId, { text: "⚠️ Archivo demasiado grande (máx. 200 MB).", quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // 3) Subir binario directo a tu API
  try {
    filename = ensureExt(filename, mime);
    const apiRes = await apiUploadRaw({ buffer, filename, mime });
    const url = pickUrlFromApi(apiRes);

    if (!url) throw new Error("Subió pero no vino URL en respuesta");

    await conn.sendMessage(chatId, { text: `✅ Archivo subido:\n${url}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error al subir:\n${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  }
};

handler.command = ["tourl3"];
handler.help = ["tourl3 — responde a un media o pasa URL"];
handler.tags = ["herramientas"];
handler.register = true;

export default handler;
