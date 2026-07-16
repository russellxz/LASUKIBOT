// plugins/toaudio.js
import fs from 'fs';
import path from 'path';
import { toAudio } from '../../libs/converter.js';

// ——— Helpers ———
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

function ensureWA(wa, conn) {
  if (wa?.downloadContentFromMessage) return wa;
  if (conn?.wa?.downloadContentFromMessage) return conn.wa;
  if (global.wa?.downloadContentFromMessage) return global.wa;
  return null;
}

function srcExtFromMime(mime, fallback) {
  if (!mime) return fallback;
  const m = mime.toLowerCase();
  if (m.includes("video/mp4")) return "mp4";
  if (m.includes("video/3gpp")) return "3gp";
  if (m.includes("audio/ogg")) return "ogg";
  if (m.includes("audio/opus")) return "opus";
  if (m.includes("audio/aac")) return "aac";
  if (m.includes("audio/mpeg") || m.includes("audio/mp3")) return "mp3";
  if (m.includes("audio/wav")) return "wav";
  return fallback;
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;

  // Prefijo por subbot (como en tus otros comandos)
  let pref = ".";
  try {
    const prefixPath = path.resolve("prefixes.json");
    if (fs.existsSync(prefixPath)) {
      const all = JSON.parse(fs.readFileSync(prefixPath, "utf-8"));
      const rawID = conn.user?.id || "";
      const subbotID = rawID.split(":")[0] + "@s.whatsapp.net";
      pref = all[subbotID] || all[chatId] || ".";
    }
  } catch {}

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const rawQuoted = ctx?.quotedMessage;
  const quoted = rawQuoted ? unwrapMessage(rawQuoted) : null;

  if (!quoted) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Responde a un video o audio para convertirlo a MP3.*\n\n✳️ *Ejemplo:*\n➤ ${pref}toaudio`,
    }, { quoted: msg });
  }

  // Detectar tipo admitido (incluye documentos con audio/video)
  let node, dlType, srcFallbackExt, pttFlag = false;

  if (quoted.videoMessage) {
    node = quoted.videoMessage;
    dlType = "video";
    srcFallbackExt = "mp4";
  } else if (quoted.audioMessage) {
    node = quoted.audioMessage;
    dlType = "audio";
    srcFallbackExt = "ogg";
    pttFlag = !!node.ptt;
  } else if (quoted.documentMessage) {
    const mime = quoted.documentMessage?.mimetype || "";
    if (mime.startsWith("audio")) {
      node = quoted.documentMessage;
      dlType = "document";
      srcFallbackExt = "mp3";
    } else if (mime.startsWith("video")) {
      node = quoted.documentMessage;
      dlType = "document";
      srcFallbackExt = "mp4";
    }
  }

  if (!node) {
    return conn.sendMessage(chatId, {
      text: "⚠️ *Solo puedes convertir videos o audios (también documentos de audio/video) a MP3.*"
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "🛠️", key: msg.key } });

  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys (wa no inyectado).");

    const stream = await WA.downloadContentFromMessage(node, dlType === "document" ? "document" : dlType);
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) throw new Error("No se pudo descargar el archivo.");

    // Elegir extensión de entrada para toAudio según mimetype real
    const srcExt = srcExtFromMime(node.mimetype, srcFallbackExt);

    // Convierte a MP3 con tu helper
    const mp3 = await toAudio(buffer, srcExt);

    await conn.sendMessage(chatId, {
      audio: mp3,
      mimetype: "audio/mpeg",
      fileName: "convertido.mp3",
      ptt: pttFlag // si el original era nota de voz, respétalo
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("❌ Error en toaudio:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Hubo un error al convertir a MP3. Intenta nuevamente.*"
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["toaudio", "tomp3"];
handler.help = ["toaudio"];
handler.tags = ["conversores"];
handler.register = true;

export default handler;
