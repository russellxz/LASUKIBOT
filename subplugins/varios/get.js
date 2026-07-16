// plugins/get.js
import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

// — helpers —
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
function drawTextImage(text) {
  const W = 800, H = 400, PAD = 40, MAXW = W - PAD * 2, LH = 36;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111111";
  ctx.font = "28px Arial";
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width <= MAXW) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  let y = (H - lines.length * LH) / 2 + 10;
  for (const l of lines) {
    ctx.fillText(l, PAD, y, MAXW);
    y += LH;
  }
  return canvas.toBuffer("image/png");
}

const handler = async (msg, { conn, wa }) => {
  try {
    const quotedRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedRaw) {
      return conn.sendMessage(msg.key.remoteJid, {
        text: "❌ Error: Debes responder a un estado de WhatsApp para descargarlo. 📝"
      }, { quoted: msg });
    }

    const q = unwrapMessage(quotedRaw);

    let mediaType = null;
    let mediaMsg  = null;
    let textBody  = null;

    if (q?.imageMessage)       { mediaType = "image"; mediaMsg = q.imageMessage; }
    else if (q?.videoMessage)  { mediaType = "video"; mediaMsg = q.videoMessage; }
    else if (q?.audioMessage)  { mediaType = "audio"; mediaMsg = q.audioMessage; }
    else if (q?.extendedTextMessage?.text || q?.conversation) {
      mediaType = "text";
      textBody  = q?.extendedTextMessage?.text || q?.conversation;
    } else {
      return conn.sendMessage(msg.key.remoteJid, {
        text: "❌ *Error:* Solo puedes descargar *imágenes, videos, audios y textos* de estados de WhatsApp."
      }, { quoted: msg });
    }

    await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

    if (mediaType === "text") {
      const buffer = drawTextImage(textBody || "");
      await conn.sendMessage(msg.key.remoteJid, {
        image: buffer,
        caption: "📝 *Estado de texto convertido en imagen*"
      }, { quoted: msg });
    } else {
      const WA = ensureWA(wa, conn);
      if (!WA) throw new Error("downloadContentFromMessage no disponible");

      const stream = await WA.downloadContentFromMessage(mediaMsg, mediaType);
      let buf = Buffer.alloc(0);
      for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);

      if (!buf.length) {
        return conn.sendMessage(msg.key.remoteJid, {
          text: "❌ *Error:* No se pudo descargar el estado. Intenta de nuevo."
        }, { quoted: msg });
      }

      const options = {};
      if (mediaType === "image") { options.image = buf; if (mediaMsg.mimetype) options.mimetype = mediaMsg.mimetype; }
      if (mediaType === "video") { options.video = buf; if (mediaMsg.mimetype) options.mimetype = mediaMsg.mimetype; }
      if (mediaType === "audio") {
        options.audio = buf;
        options.ptt = mediaMsg.ptt ?? false;
        options.mimetype = mediaMsg.mimetype || "audio/ogg";
        if (mediaMsg.seconds) options.seconds = mediaMsg.seconds;
      }

      await conn.sendMessage(msg.key.remoteJid, options, { quoted: msg });
    }

    await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    console.error("get (status) error:", e);
    await conn.sendMessage(msg.key.remoteJid, {
      text: "❌ *Error:* Hubo un problema al procesar el estado."
    }, { quoted: msg });
  }
};

handler.command = ["get"];
export default handler;
