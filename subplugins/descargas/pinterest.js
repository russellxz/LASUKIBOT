import { canal } from "../../disenos.js";
import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// commands/pinterestvideo.js
"use strict";

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

// límites (WhatsApp suele limitar, pero aquí controlas tu lado)
const MAX_MB = 500; // <- aquí tu límite (500MB)
const TMP_DIR = path.join(__dirname, "../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function isPinterestUrl(u = "") {
  return /^https?:\/\//i.test(u) && /(pinterest\.[a-z.]+|pin\.it)/i.test(u);
}

function safeName(name = "pinterest") {
  return String(name)
    .slice(0, 80)
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "pinterest";
}

function toAbsUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return API_BASE + u;
  return API_BASE + "/" + u;
}

async function callPinterestApi(pinUrl) {
  const endpoint = `${API_BASE}/pinterest`;

  const r = await axios.post(
    endpoint,
    { url: pinUrl },
    {
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Accept: "application/json, */*",
      },
      validateStatus: () => true,
    }
  );

  const data = typeof r.data === "object" ? r.data : null;
  const ok = data && (data.status === true || data.status === "true" || data.ok === true || data.success === true);
  if (!ok) throw new Error(data?.message || data?.error || "Error en la API");

  return data.result || data.data || data;
}

async function downloadToFile(url, outPath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    maxRedirects: 5,
    headers: {
      apikey: API_KEY, // <- importante si descargas desde /pinterest/dl
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    // por si el archivo es grande
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  if (res.status >= 400) throw new Error(`Upstream HTTP ${res.status}`);

  // check size si viene content-length
  const cl = Number(res.headers["content-length"] || 0);
  const mb = cl ? cl / (1024 * 1024) : 0;
  if (mb && mb > MAX_MB) {
    try { res.data.destroy(); } catch {}
    throw new Error(`El archivo pesa ${mb.toFixed(2)}MB (>${MAX_MB}MB)`);
  }

  await streamPipe(res.data, fs.createWriteStream(outPath));
  return outPath;
}

// ---------------- COMMAND ----------------
const handler = async (msg, { conn, text }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  const url = String(text || "").trim();

  if (!url) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `📌 Usa:\n${pref}pinterestvideo <link>\nEj: ${pref}pinterestvideo https://pin.it/xxxxx` },
      { quoted: msg }
    );
  }

  if (!isPinterestUrl(url)) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "❌ Eso no parece un link de Pinterest." }, { quoted: msg });
  }

  // reacción: arrancando
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    const result = await callPinterestApi(url);

    // Preferimos el link del proxy (downloads.video) si existe.
    // OJO: en tu API los downloads suelen venir como "/pinterest/dl?..."
    const title = result.title || "Pinterest";
    const base = safeName(title);

    const mp4 =
      toAbsUrl(result?.downloads?.video) ||
      toAbsUrl(result?.downloads?.video_inline) ||
      toAbsUrl(result?.media?.mp4) ||
      ""; // último fallback

    if (!mp4) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "❌ No encontré MP4 para este pin (puede ser solo HLS .m3u8)." }, { quoted: msg });
    }

    // reacción: descargando
    await conn.sendMessage(chatId, { react: { text: "📌", key: msg.key } });

    const outFile = path.join(TMP_DIR, `${Date.now()}_${base}.mp4`);
    await downloadToFile(mp4, outFile);

    // tamaño real (por si no venía content-length)
    const sizeMB = fs.statSync(outFile).size / (1024 * 1024);
    if (sizeMB > MAX_MB) {
      try { fs.unlinkSync(outFile); } catch {}
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        {
      contextInfo: canal(), text: `❌ El video pesa ${sizeMB.toFixed(2)}MB (>${MAX_MB}MB).` },
        { quoted: msg }
      );
    }

    // enviar
    const caption =
      `📌 Pinterest Video\n` +
      `• Título: ${title}\n` +
      (result?.creator?.username ? `• Autor: @${result.creator.username}\n` : "") +
      `• Tamaño: ${sizeMB.toFixed(2)}MB`;

    await conn.sendMessage(
      chatId,
      {
        video: fs.readFileSync(outFile),
        mimetype: "video/mp4",
        fileName: `${base}.mp4`,
        caption,
      },
      { quoted: msg }
    );

    try { fs.unlinkSync(outFile); } catch {}

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
  }
};

// alias del comando
handler.command = ["pinterestvideo", "pinvideo"];

export default handler;
