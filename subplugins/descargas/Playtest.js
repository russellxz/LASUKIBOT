import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// commands/playtest.js
import axios from 'axios';
import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== CONFIG DE TU API ====
const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz"; // <-- tu API Key

// Almacena tareas pendientes por previewMessageId
const pending = {};

// Utilidad: descarga a disco y devuelve ruta
async function downloadToFile(url, filePath) {
  const res = await axios.get(url, { responseType: "stream" });
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// Utilidad: tamaño en MB (decimal)
function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}

// Llama a tu API /api/download/yt.php
async function callMyApi(url, format) {
  const r = await axios.get(`${API_BASE}/api/download/yt.php`, {
    params: { url, format }, // format: 'audio' | 'video'
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 60000
  });
  // Estructura esperada: { status:'true', data:{ title, audio, video, thumbnail, ... } }
  if (!r.data || r.data.status !== "true" || !r.data.data) {
    throw new Error("API inválida o sin datos");
  }
  return r.data.data;
}

const handler = async (msg, { conn, text }) => {
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  if (!text || !text.trim()) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: `✳️ Usa:\n${pref}playtest <término>\nEj: *${pref}playtest* bad bunny diles` },
      { quoted: msg }
    );
  }

  // reacción de carga
  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "⏳", key: msg.key }
  });

  // búsqueda
  const res = await yts(text);
  const video = res.videos?.[0];
  if (!video) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "❌ Sin resultados." },
      { quoted: msg }
    );
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail } = video;
  const viewsFmt = (views || 0).toLocaleString();

  const caption = `
❦𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺❦

📀 𝙸𝚗𝚏𝚘 𝚍𝚎𝚕 𝚟𝚒𝚍𝚎𝚘:
❥ 𝑻𝒊𝒕𝒖𝒍𝒐: ${title}
❥ 𝑫𝒖𝒓𝒂𝒄𝒊𝒐𝒏: ${duration}
❥ 𝑽𝒊𝒔𝒕𝒂𝒔: ${viewsFmt}
❥ 𝑨𝒖𝒕𝒐𝒓: ${author?.name || author || "Desconocido"}
❥ 𝑳𝒊𝒏𝒌: ${videoUrl}

📥 𝙾𝚙𝚌𝚒𝚘𝚗𝚎𝚜 𝚍𝚎 𝙳𝚎𝚜𝚌𝚊𝚛𝚐𝚊 (reacciona o responde al mensaje):
☛ 👍 Audio MP3     (1 / audio)
☛ ❤️ Video MP4     (2 / video)
☛ 📄 Audio Doc     (4 / audiodoc)
☛ 📁 Video Doc     (3 / videodoc)

❦𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺❦
`.trim();

  // envía preview
  const preview = await conn.sendMessage(
    msg.key.remoteJid,
    { image: { url: thumbnail }, caption },
    { quoted: msg }
  );

  // guarda trabajo
  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl,
    title,
    commandMsg: msg,
    done: { audio: false, video: false, audioDoc: false, videoDoc: false }
  };

  // confirmación
  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "✅", key: msg.key }
  });

  // listener único
  if (!conn._playproListener) {
    conn._playproListener = true;
    conn.ev.on("messages.upsert", async ev => {
      for (const m of ev.messages) {
        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) {
            await handleDownload(conn, job, emoji, job.commandMsg);
          }
        }

        // 2) RESPUESTAS CITADAS
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          const texto = (
            m.message?.conversation?.toLowerCase() ||
            m.message?.extendedTextMessage?.text?.toLowerCase() ||
            ""
          ).trim();
          const job = pending[citado];
          const chatId = m.key.remoteJid;
          if (citado && job) {
            // AUDIO
            if (["1", "audio", "4", "audiodoc"].includes(texto)) {
              const docMode = ["4", "audiodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📄" : "🎵", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎶 Descargando audio...` }, { quoted: m });
              await downloadAudio(conn, job, docMode, m);
            }
            // VIDEO
            else if (["2", "video", "3", "videodoc"].includes(texto)) {
              const docMode = ["3", "videodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎥 Descargando video...` }, { quoted: m });
              await downloadVideo(conn, job, docMode, m);
            }
            // AYUDA
            else {
              await conn.sendMessage(chatId, {
                text: `⚠️ Opciones válidas:\n1/audio, 4/audiodoc → audio\n2/video, 3/videodoc → video`
              }, { quoted: m });
            }

            // elimina de pending después de 5 minutos
            if (!job._timer) {
              job._timer = setTimeout(() => delete pending[citado], 5 * 60 * 1000);
            }
          }
        } catch (e) {
          console.error("Error en detector citado:", e);
        }
      }
    });
  }
};

async function handleDownload(conn, job, choice) {
  const mapping = {
    "👍": "audio",
    "❤️": "video",
    "📄": "audioDoc",
    "📁": "videoDoc"
  };
  const key = mapping[choice];
  if (key) {
    const isDoc = key.endsWith("Doc");
    await conn.sendMessage(job.chatId, { text: `⏳ Descargando ${isDoc ? "documento" : key}…` }, { quoted: job.commandMsg });
    if (key.startsWith("audio")) await downloadAudio(conn, job, isDoc, job.commandMsg);
    else await downloadVideo(conn, job, isDoc, job.commandMsg);
  }
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  // 1) Pide a TU API audio (descuenta soli en servidor)
  const data = await callMyApi(videoUrl, "audio");
  const mediaUrl = data.audio || data.video; // fallback si el upstream devolviera solo video

  if (!mediaUrl) throw new Error("No se pudo obtener audio");

  // 2) Descarga + (opcional) convierte a MP3 si no es mp3/mpeg
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  // detecta extensión
  const urlPath = new URL(mediaUrl).pathname || "";
  const ext = (urlPath.split(".").pop() || "").toLowerCase();
  const isMp3 = ext === "mp3";

  const inFile  = path.join(tmp, `${Date.now()}_in.${ext || "bin"}`);
  await downloadToFile(mediaUrl, inFile);

  let outFile = inFile;
  if (!isMp3) {
    // convertir a mp3 (si falla, mandamos el original como documento)
    const tryOut = path.join(tmp, `${Date.now()}_out.mp3`);
    try {
      await new Promise((resolve, reject) =>
        ffmpeg(inFile)
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .format("mp3")
          .save(tryOut)
          .on("end", resolve)
          .on("error", reject)
      );
      outFile = tryOut;
      // limpia entrada original
      try { fs.unlinkSync(inFile); } catch {}
    } catch (e) {
      // fallback: mandamos el original como documento de audio
      outFile = inFile;
    }
  }

  // 3) Límite ~99MB
  const sizeMB = fileSizeMB(outFile);
  if (sizeMB > 99) {
    try { fs.unlinkSync(outFile); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El archivo de audio pesa ${sizeMB.toFixed(2)}MB (>99MB).` }, { quoted });
    return;
  }

  // 4) Enviar
  const buffer = fs.readFileSync(outFile);
  await conn.sendMessage(chatId, {
    [asDocument ? "document" : "audio"]: buffer,
    mimetype: "audio/mpeg",
    fileName: `${title}.mp3`
  }, { quoted });

  try { fs.unlinkSync(outFile); } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  // 1) Pide a TU API video (descuenta soli en servidor)
  const data = await callMyApi(videoUrl, "video");
  const mediaUrl = data.video || data.audio; // fallback

  if (!mediaUrl) throw new Error("No se pudo obtener video");

  // 2) Descarga
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `${Date.now()}_vid.mp4`);
  await downloadToFile(mediaUrl, file);

  // 3) Límite ~99MB
  const sizeMB = fileSizeMB(file);
  if (sizeMB > 99) {
    try { fs.unlinkSync(file); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El video pesa ${sizeMB.toFixed(2)}MB (>99MB).` }, { quoted });
    return;
  }

  // 4) Enviar
  await conn.sendMessage(chatId, {
    [asDocument ? "document" : "video"]: fs.readFileSync(file),
    mimetype: "video/mp4",
    fileName: `${title}.mp4`,
    caption: asDocument ? undefined : `🎬 𝐀𝐪𝐮𝐢́ 𝐭𝐢𝐞𝐧𝐞𝐬 𝐭𝐮 𝐯𝐢𝐝𝐞𝐨~ 💫\n© 𝐋𝐚 𝐒𝐮𝐤𝐢 𝐁𝐨𝐭`
  }, { quoted });

  try { fs.unlinkSync(file); } catch {}
}

handler.command = ["playtest"];

export default handler;
