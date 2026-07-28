import { cabeceraDescarga, camposDescarga, pieDescarga, getMarca, canal } from "../../disenos.js";
import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// comandos/ytmp3.js — YouTube MP3 (URL)
// ✅ MP3 vía API Sky Ultra Plus (POST /youtube)
// ✅ Botones directos: 🎵 Audio / 📄 Audio Documento
// ✅ Mensaje de opciones: solo explicación de descarga
// ✅ Info del audio: va con el archivo descargado
// ✅ Respeta activoss.json

"use strict";

import axios from 'axios';
import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== API SKY ULTRA PLUS ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const API_YOUTUBE = `${API_BASE}/youtube`;

const MAX_MB = 200;
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pending = {};

// ---------- utils ----------
function safeName(name = "audio") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "audio"
  );
}

function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}

function ensureTmp() {
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: a esos
// usuarios no les salen los botones, se les manda la versión de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));


function botonesActivos() {
  const defaultCfg = { botones: true, updatedAt: null, updatedBy: null };

  if (!fs.existsSync(ACTIVOSS_FILE)) {
    try {
      fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2));
    } catch {}
    return true;
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

function isYouTube(u = "") {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u));
}

function isApiUrl(url = "") {
  try {
    const u = new URL(url);
    const b = new URL(API_BASE);
    return u.host === b.host;
  } catch {
    return false;
  }
}

async function downloadToFile(url, filePath) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*"
  };

  if (isApiUrl(url)) {
    headers["apikey"] = API_KEY;
  }

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);

  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// ---------- API ----------
// La API responde { status, result: { title, cover, quality, media } }.
// El enlace puede venir como string directo o dentro de un objeto: lo normalizamos.
function pickMediaUrl(result) {
  const media = result?.media;
  let url = "";

  if (typeof media === "string") {
    url = media;
  } else if (media && typeof media === "object") {
    url = media.dl_download || media.direct || media.url || media.download || "";
  }

  if (!url || typeof url !== "string") url = result?.url || result?.download || "";
  if (typeof url !== "string") url = "";
  if (url.startsWith("/")) url = API_BASE + url;

  return url;
}

async function callYoutubeAudio(videoUrl) {
  const r = await axios.post(
    API_YOUTUBE,
    { url: videoUrl, type: "audio" },
    {
      timeout: 120000,
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Accept: "application/json, */*"
      },
      validateStatus: () => true
    }
  );

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;
  const media = pickMediaUrl(result);

  if (!media) throw new Error("API sin media");

  return {
    title: result.title || "YouTube Audio",
    thumbnail: result.cover || result.thumbnail || "",
    dl_download: media,
    direct: media
  };
}

// ---------- main ----------
const handler = async (msg, { conn, args, command }) => {
  const pref = global.prefixes?.[0] || ".";
  const url = (args[0] || "").trim();

  if (!url) {
    return conn.sendMessage(
      msg.key.remoteJid,
      {
      contextInfo: canal(), text: `✳️ Usa:\n${pref}${command} <URL de YouTube>` },
      { quoted: msg }
    );
  }

  if (!isYouTube(url)) {
    return conn.sendMessage(
      msg.key.remoteJid,
      {
      contextInfo: canal(), text: "❌ Enlace inválido." },
      { quoted: msg }
    );
  }

  await conn.sendMessage(msg.key.remoteJid, {
    react: {
      text: "⏳",
      key: msg.key
    }
  });

  let title = "YouTube Audio";
  let thumbnail = "";
  let duration = "—";
  let viewsFmt = "—";
  let authorName = "Desconocido";

  try {
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);

    if (videoIdMatch) {
      const searchRes = await yts({ videoId: videoIdMatch[1] });

      if (searchRes) {
        title = searchRes.title || title;
        thumbnail = searchRes.thumbnail || "";
        duration = searchRes.timestamp || "—";
        viewsFmt = (searchRes.views || 0).toLocaleString();
        authorName = searchRes.author?.name || searchRes.author || "Desconocido";
      }
    }
  } catch {}

  const usarBotones = botonesActivos() && !esIphone(msg);

  // Ficha con la info del resultado (va UNA sola vez, aquí)
  const fichaInfo = camposDescarga(conn, [
    ["Título", title],
    ["Canal", authorName],
    ["Duración", duration],
    ["Vistas", viewsFmt],
    ["Enlace", url]
  ]);

  const caption = usarBotones
    ? `
${cabeceraDescarga(conn, "🎵 RESULTADO ENCONTRADO")}

${fichaInfo}

🟢 *OPCIÓN 1 — Botones*
Toca un botón abajo del mensaje:
   🎵 *Audio*
   📄 *Audio Documento*

${pieDescarga(conn)}
`.trim()
    : `
${cabeceraDescarga(conn, "🎵 RESULTADO ENCONTRADO")}

${fichaInfo}

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Audio MP3
   📄  →  Audio como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1* o *audio*      →  Audio MP3
   *2* o *audiodoc*   →  Audio como documento

${pieDescarga(conn)}
`.trim();

  const nativeFlowButtons = [
    {
      text: "🎵 Audio",
      id: `${pref}ytmp3_audio`
    },
    {
      text: "📄 Audio Documento",
      id: `${pref}ytmp3_audiodoc`
    }
  ];

  let preview;

  if (usarBotones) {
    try {
      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
      contextInfo: canal(),
          image: thumbnail ? { url: thumbnail } : undefined,
          caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons: nativeFlowButtons,
          headerType: 4
        },
        { quoted: msg }
      );
    } catch (e) {
      console.log("[ytmp3] botones fallaron, fallback:", e.message);

      preview = await conn.sendMessage(
        msg.key.remoteJid,
        thumbnail ? { image: { url: thumbnail }, caption } : { text: caption },
        { quoted: msg }
      );
    }
  } else {
    preview = await conn.sendMessage(
      msg.key.remoteJid,
      thumbnail ? { image: { url: thumbnail }, caption } : { text: caption },
      { quoted: msg }
    );
  }

  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl: url,
    title,
    thumbnail,
    duration,
    viewsFmt,
    authorName,
    commandMsg: msg,
    _createdAt: Date.now()
  };

  setTimeout(() => {
    delete pending[preview.key.id];
  }, 10 * 60 * 1000);

  await conn.sendMessage(msg.key.remoteJid, {
    react: {
      text: "✅",
      key: msg.key
    }
  });

  if (!conn._ytmp3ProListener) {
    conn._ytmp3ProListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];

          if (job) await handleReaction(conn, job, emoji, job.commandMsg);
          continue;
        }

        try {
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            m.message?.listResponseMessage ||
            null;

          if (interactiveReply) {
            let selectedId = "";

            if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            } else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
              selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } else if (interactiveReply?.paramsJson) {
              try {
                const params = JSON.parse(interactiveReply.paramsJson);
                selectedId = params.id || "";
              } catch {}
            } else if (interactiveReply?.body?.text) {
              selectedId = interactiveReply.body.text;
            }

            if (!selectedId) continue;
            if (!selectedId.includes("ytmp3_")) continue;

            const ctxQuoted =
              m.message?.buttonsResponseMessage?.contextInfo?.stanzaId ||
              m.message?.listResponseMessage?.contextInfo?.stanzaId ||
              m.message?.templateButtonReplyMessage?.contextInfo?.stanzaId ||
              m.message?.interactiveResponseMessage?.contextInfo?.stanzaId ||
              m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;

            if (ctxQuoted) {
              // La selección cita una tarjeta concreta: si no es NUESTRA, no es
              // para este bot. Sin esto, el bot principal y los subbots
              // descargaban lo mismo a la vez.
              job = pending[ctxQuoted];
              if (!job) continue;
            } else {
              const jobsInChat = Object.entries(pending)
                .filter(([, j]) => j.chatId === m.key.remoteJid)
                .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));

              if (jobsInChat.length > 0) job = jobsInChat[0][1];
            }

            if (!job) continue;

            await handleMenuSelection(conn, job, selectedId, m, pref);
            continue;
          }
        } catch (e) {
          console.error("[ytmp3] error botones:", e);
        }

        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          const texto = String(
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            ""
          ).trim().toLowerCase();

          const job = pending[citado];
          const chatId = m.key.remoteJid;

          if (citado && job) {
            const firstWord = texto.split(/\s+/)[0];

            if (["1", "audio"].includes(firstWord)) {
              await conn.sendMessage(chatId, {
                react: {
                  text: "🎵",
                  key: m.key
                }
              });

              await conn.sendMessage(
                chatId,
                {
      contextInfo: canal(), text: `🎶 Descargando audio (mp3)...` },
                { quoted: m }
              );

              await downloadAudio(conn, job, false, m);
            } else if (["2", "audiodoc", "doc", "documento"].includes(firstWord)) {
              await conn.sendMessage(chatId, {
                react: {
                  text: "📄",
                  key: m.key
                }
              });

              await conn.sendMessage(
                chatId,
                {
      contextInfo: canal(), text: `🎶 Descargando audio como documento...` },
                { quoted: m }
              );

              await downloadAudio(conn, job, true, m);
            }
          }
        } catch (e) {}
      }
    });
  }
};

// ====== Manejar selección de botones ======
async function handleMenuSelection(conn, job, selectedId, m, pref) {
  const chatId = m.key.remoteJid;
  const id = String(selectedId).trim();

  if (id === `${pref}ytmp3_audio` || id.endsWith("ytmp3_audio")) {
    await conn.sendMessage(chatId, {
      react: {
        text: "🎵",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `🎶 Descargando audio (mp3)...` },
      { quoted: m }
    );

    return downloadAudio(conn, job, false, m);
  }

  if (id === `${pref}ytmp3_audiodoc` || id.endsWith("ytmp3_audiodoc")) {
    await conn.sendMessage(chatId, {
      react: {
        text: "📄",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `🎶 Descargando audio como documento...` },
      { quoted: m }
    );

    return downloadAudio(conn, job, true, m);
  }
}

// ====== Manejar reacciones ======
async function handleReaction(conn, job, emoji, quoted) {
  if (emoji === "👍") {
    await conn.sendMessage(
      job.chatId,
      {
      contextInfo: canal(), text: `⏳ Descargando audio (mp3)...` },
      { quoted }
    );

    return downloadAudio(conn, job, false, quoted);
  }

  if (emoji === "📄" || emoji === "❤️") {
    await conn.sendMessage(
      job.chatId,
      {
      contextInfo: canal(), text: `⏳ Descargando audio como documento...` },
      { quoted }
    );

    return downloadAudio(conn, job, true, quoted);
  }
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title, duration, viewsFmt, authorName } = job;

  let resolved;

  try {
    resolved = await callYoutubeAudio(videoUrl);
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Error API (audio): ${e.message}` },
      { quoted }
    );
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;

  if (!mediaUrl) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: "❌ No se pudo obtener audio." },
      { quoted }
    );
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const inFile = path.join(tmp, `${Date.now()}_audio.bin`);

  try {
    await downloadToFile(mediaUrl, inFile);
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
      text: `❌ Error descargando audio: ${e.message}` },
      { quoted }
    );
    return;
  }

  const outMp3 = path.join(tmp, `${Date.now()}_${base}.mp3`);
  let outFile = outMp3;

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inFile)
        .audioCodec("libmp3lame")
        .audioBitrate("128k")
        .format("mp3")
        .save(outMp3)
        .on("end", resolve)
        .on("error", reject);
    });

    try {
      fs.unlinkSync(inFile);
    } catch {}
  } catch {
    outFile = inFile;
    asDocument = true;
  }

  const sizeMB = fileSizeMB(outFile);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(outFile);
    } catch {}

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Audio > ${MAX_MB}MB.` },
      { quoted }
    );

    return;
  }


  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: fs.readFileSync(outFile),
      mimetype: "audio/mpeg",
      ptt: false,   // archivo MP3, no nota de voz
      fileName: `${base}.mp3`,
    },
    { quoted }
  );


  try {
    fs.unlinkSync(outFile);
  } catch {}
}

handler.command = ["ytmp3", "yta"];
handler.help = ["ytmp3 <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
