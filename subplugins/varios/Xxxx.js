// plugins/xxx2.js — ESM-safe NSFW checker
"use strict";

import Checker from '../../libs/nsfw.js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

// —— helpers ——
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

function getQuotedMessage(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctxs = [
    root?.extendedTextMessage?.contextInfo,
    root?.imageMessage?.contextInfo,
    root?.videoMessage?.contextInfo,
    root?.audioMessage?.contextInfo,
    root?.documentMessage?.contextInfo,
    root?.stickerMessage?.contextInfo,
  ].filter(Boolean);
  for (const c of ctxs) if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  return null;
}

async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa.downloadContentFromMessage;
  const m = await import("@whiskeysockets/baileys");
  return m.downloadContentFromMessage;
}

async function downloadToBuffer(DL, type, content) {
  const stream = await DL(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// —— handler ——
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;

  // downloader ESM-safe
  let DL;
  try { DL = await getDownloader(wa); }
  catch (e) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo cargar el downloader de Baileys." }, { quoted: msg });
    return;
  }

  try { await conn.sendMessage(chatId, { react: { text: "🔍", key: msg.key } }); } catch {}

  const quoted = getQuotedMessage(msg);
  if (!quoted) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *Responde a un video, imagen o sticker para analizar NSFW.*" },
      { quoted: msg }
    );
  }

  let buffer = null, mimeType = "image/png";
  const tmpId  = (msg.key.id || String(Date.now())).replace(/[^a-zA-Z0-9]/g, "");
  const inPath = path.join(os.tmpdir(), `${tmpId}.mp4`);
  const outPath= path.join(os.tmpdir(), `${tmpId}.webp`);

  try {
    if (quoted.videoMessage) {
      // Descargar video y extraer 1 frame → webp 512x512
      const vbuf = await downloadToBuffer(DL, "video", quoted.videoMessage);
      await fs.promises.writeFile(inPath, vbuf);

      await new Promise((resolve, reject) => {
        ffmpeg(inPath)
          .outputOptions([
            "-vframes 1",
            "-vf",
            "thumbnail,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0,setsar=1",
            "-vcodec", "libwebp",
            "-q:v", "80"
          ])
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });

      buffer = await fs.promises.readFile(outPath);
      mimeType = "image/webp";
    } else if (quoted.imageMessage || quoted.stickerMessage) {
      const isSticker = !!quoted.stickerMessage;
      const node = isSticker ? quoted.stickerMessage : quoted.imageMessage;
      const type = isSticker ? "sticker" : "image";
      buffer = await downloadToBuffer(DL, type, node);
      mimeType = node.mimetype || (isSticker ? "image/webp" : "image/png");
    } else {
      return conn.sendMessage(
        chatId,
        { text: "❌ *Tipo no soportado. Usa video, imagen o sticker.*" },
        { quoted: msg }
      );
    }

    // Analizar con Checker NSFW
    const checker = new Checker();
    const result  = await checker.response(buffer, mimeType);
    if (!result?.status) throw new Error(result?.msg || "Error desconocido del analizador.");

    const { NSFW, percentage, response } = result.result || {};
    const estado = NSFW ? "🔞 *NSFW detectado*" : "✅ *Contenido seguro*";

    await conn.sendMessage(
      chatId,
      { text: `${estado}\n📊 *Confianza:* ${percentage}\n\n${response || ""}`.trim() },
      { quoted: msg }
    );

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}

  } catch (err) {
    console.error("[xxx2] NSFW error:", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: `❌ *Error al analizar el archivo:* ${err?.message || "Fallo desconocido."}` },
      { quoted: msg }
    );
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  } finally {
    safeUnlink(inPath);
    safeUnlink(outPath);
  }
};

handler.command  = ["xxx"];
handler.tags     = ["tools"];
handler.help     = ["xxx <responde a un video, imagen o sticker>"];
handler.register = true;

export default handler;
