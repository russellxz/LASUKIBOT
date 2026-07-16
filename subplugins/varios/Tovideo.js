import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/tovideo.js — ESM-safe: sticker (.webp) → .mp4 con fallback a API
"use strict";

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipeline = promisify(pipeline);

const CDN_ENDPOINT = "https://cdn.russellxz.click";
const NEOXR_URL    = "https://api.neoxr.eu/api/webp2mp4";
const NEOXR_KEY    = "russellxz";

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

function getQuotedSticker(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctx =
    root?.extendedTextMessage?.contextInfo ||
    root?.imageMessage?.contextInfo ||
    root?.videoMessage?.contextInfo ||
    root?.audioMessage?.contextInfo ||
    root?.documentMessage?.contextInfo ||
    root?.stickerMessage?.contextInfo ||
    null;

  const q = ctx?.quotedMessage ? unwrapMessage(ctx.quotedMessage) : null;
  return q?.stickerMessage || null;
}

async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa.downloadContentFromMessage;
  try {
    const m = await import("@whiskeysockets/baileys");
    return m.downloadContentFromMessage;
  } catch {
    throw new Error("No encontré downloader de Baileys. Pasa `wa` al handler o instala @whiskeysockets/baileys.");
  }
}

async function ffmpegWebpToMp4(inputPath, outputPath, isAnimated = true) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      ...(isAnimated ? [] : ["-loop", "1", "-t", "4", "-r", "24"]),
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ];
    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", d => (stderr += d.toString()));
    ff.on("exit", code => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
      reject(new Error(stderr || "ffmpeg failed"));
    });
  });
}

function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// ——— Handler ———
const handler = async (msg, { conn, command, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref   = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  // Downloader ESM-safe
  const downloadContentFromMessage = await getDownloader(wa);

  const quotedSticker = getQuotedSticker(msg);
  if (!quotedSticker) {
    await conn.sendMessage(chatId, {
      text: `⚠️ *Responde a un sticker para convertirlo a video.*\n\n📌 Ejemplo: *${pref}${command || "tovideo"}*`,
    }, { quoted: msg });
    return;
  }

  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const input  = path.join(tmp, `${Date.now()}.webp`);
  const output = path.join(tmp, `${Date.now()}_out.mp4`);

  try {
    // 1) Descargar sticker (ESM-safe)
    const stStream = await downloadContentFromMessage(quotedSticker, "sticker");
    const ws = fs.createWriteStream(input);
    for await (const chunk of stStream) ws.write(chunk);
    ws.end();
    await new Promise(r => ws.on("finish", r));

    // 2) Convertir local con ffmpeg (si falla, usamos fallback API)
    const animated = typeof quotedSticker.isAnimated === "boolean" ? quotedSticker.isAnimated : true;
    try {
      await ffmpegWebpToMp4(input, output, animated);
    } catch (eLocal) {
      // 3) Fallback: subir al CDN y convertir via API
      const form = new FormData();
      form.append("file", fs.createReadStream(input));
      const up = await axios.post(CDN_ENDPOINT, form, { headers: form.getHeaders(), timeout: 120000 });
      if (!up.data?.url) throw new Error("No se pudo subir el sticker al CDN");

      const conv = await axios.get(`${NEOXR_URL}?url=${encodeURIComponent(up.data.url)}&apikey=${NEOXR_KEY}`, { timeout: 120000 });
      const videoUrl = conv.data?.data?.url;
      if (!videoUrl) throw new Error("No se pudo convertir el sticker a video (API)");

      const vStream = await axios.get(videoUrl, { responseType: "stream", timeout: 120000 });
      const wv = fs.createWriteStream(output);
      await streamPipeline(vStream.data, wv);
    }

    // 4) Enviar video resultante
    await conn.sendMessage(chatId, {
      video: fs.readFileSync(output),
      mimetype: "video/mp4",
      caption: "✅ *Sticker convertido a video.*\n\n🍧 _Suki Subbots_"
    }, { quoted: msg });

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  } catch (err) {
    console.error("[tovideo] Error:", err);
    await conn.sendMessage(chatId, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  } finally {
    safeUnlink(input);
    safeUnlink(output);
  }
};

handler.command  = ["tovideo"];
handler.help     = ["tovideo"];
handler.tags     = ["tools"];
handler.register = true;

export default handler;
