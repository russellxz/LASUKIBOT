
"use strict";

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== CONFIG API ====
const API_BASE = "https://api-sky.ultraplus.click"; // Tu dominio
const API_KEY  = "Russellxz"; // Tu API Key real

// Configuración de Axios para archivos grandes
axios.defaults.timeout = 0;
axios.defaults.maxBodyLength = Infinity;
axios.defaults.maxContentLength = Infinity;

// Calidades válidas soportadas por tu API
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);
const DEFAULT_QUALITY = "360";

// Almacena trabajos pendientes para la interactividad
const pendingYTV = Object.create(null);

function isYouTube(u = "") {
  return /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);
}

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function safeName(name = "video") {
  return String(name).slice(0, 90).replace(/[^\w.\- ]+/g, "_").trim() || "video";
}

// Separa URL y Calidad del mensaje (ej: .ytmp4 link 720)
function splitUrlAndQuality(raw = "") {
  const t = String(raw || "").trim();
  if (!t) return { url: "", quality: "" };
  const parts = t.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();

  let q = "";
  if (last === "4k") q = "4k";
  else {
    const m = last.match(/^(144|240|360|720|1080|1440)p?$/i);
    if (m) q = m[1];
  }

  if (q) {
    parts.pop();
    return { url: parts.join(" ").trim(), quality: q };
  }
  return { url: t, quality: "" };
}

// Descarga el video al servidor local
async function downloadToFile(url, filePath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 0,
    headers: { "apikey": API_KEY } // Importante para que tu API deje descargar
  });

  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// ==== LLAMADA A TU API (RESOLVE) ====
async function callYoutubeResolveVideo(videoUrl, quality) {
  const endpoint = `${API_BASE}/youtube-mp4/resolve`;

  console.log(`[YTMP4] Solicitando: ${videoUrl} (${quality})`);

  const r = await axios.post(
    endpoint,
    { url: videoUrl, type: "video", quality: quality || DEFAULT_QUALITY },
    { headers: { "Content-Type": "application/json", "apikey": API_KEY } }
  );

  const data = r.data;
  if (!data.status) throw new Error(data.message || "Error en la API");
  const result = data.result;

  // CORRECCIÓN DEL LINK RELATIVO (Aquí estaba el error antes)
  let dl = result.media.dl_inline || result.media.dl_download || "";
  if (dl && dl.startsWith("/")) {
      dl = API_BASE + dl; // Le pegamos el dominio https://...
  }

  return {
    title: result.title || "YouTube Video",
    thumbnail: result.thumbnail || "",
    mediaUrl: dl,
  };
}

// ==== HANDLER PRINCIPAL ====
const handler = async (msg, { conn, text, usedPrefix, command }) => {
  const chatId = msg.key.remoteJid;
  const { url, quality } = splitUrlAndQuality(text);
  const chosenQ = VALID_QUALITIES.has(quality) ? quality : DEFAULT_QUALITY;

  if (!url) {
    return conn.sendMessage(chatId, { text: `✳️ Usa: ${usedPrefix + command} <url> [calidad]\nEj: ${usedPrefix + command} https://youtu.be/xxx 720` }, { quoted: msg });
  }

  try {
    // Mensaje interactivo
    const caption = `⚡ *YouTube MP4*
    
⚙️ Calidad seleccionada: *${chosenQ}p*
👍 Reacciona para *Video Normal*
❤️ Reacciona para *Documento*

O responde 1 (Video) / 2 (Doc)`;

    const sentMsg = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });

    // Guardamos la tarea pendiente
    pendingYTV[sentMsg.key.id] = {
      chatId,
      url,
      quality: chosenQ,
      baseMsg: msg, // Mensaje original del usuario
      botMsg: sentMsg // Mensaje del bot para editar/reaccionar
    };

    // --- LISTENER DE EVENTOS (Reacciones y Respuestas) ---
    if (!conn._ytvListener) {
      conn._ytvListener = true;
      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // 1. Detección de Reacciones (👍 / ❤️)
            if (m.message?.reactionMessage) {
              const { key: reactedKey, text: emoji } = m.message.reactionMessage;
              const job = pendingYTV[reactedKey.id];
              if (!job) continue;

              if (emoji === "👍" || emoji === "❤️") {
                const asDoc = emoji === "❤️";
                await processSend(conn, job, asDoc);
                delete pendingYTV[reactedKey.id]; // Limpiar tarea
              }
            }

            // 2. Detección de Respuestas de Texto (1 / 2)
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            if (ctx?.stanzaId && pendingYTV[ctx.stanzaId]) {
                const job = pendingYTV[ctx.stanzaId];
                const text = (m.message.conversation || m.message.extendedTextMessage.text || "").trim();
                
                if (text === "1" || text === "2") {
                    await processSend(conn, job, text === "2");
                    delete pendingYTV[ctx.stanzaId];
                }
            }
          } catch (e) { console.error(e); }
        }
      });
    }

  } catch (err) {
    console.error(err);
    conn.sendMessage(chatId, { text: `❌ Error: ${err.message}` }, { quoted: msg });
  }
};

// ==== FUNCIÓN DE PROCESAMIENTO Y ENVÍO ====
async function processSend(conn, job, asDocument) {
  try {
    await conn.sendMessage(job.chatId, { react: { text: "⏳", key: job.botMsg.key } });
    
    // 1. Obtener Link de la API
    const data = await callYoutubeResolveVideo(job.url, job.quality);
    
    // 2. Descargar archivo localmente
    const tmpDir = ensureTmp();
    const fileName = `${safeName(data.title)}_${job.quality}p.mp4`;
    const filePath = path.join(tmpDir, fileName);
    
    await downloadToFile(data.mediaUrl, filePath);

    // 3. Enviar a WhatsApp
    const caption = `🎥 *${data.title}*\n⚡ Calidad: ${job.quality}p\n🤖 SkyUltraPlus API`;
    
    if (asDocument) {
        await conn.sendMessage(job.chatId, { 
            document: { url: filePath }, 
            mimetype: 'video/mp4', 
            fileName: fileName,
            caption 
        }, { quoted: job.baseMsg });
    } else {
        await conn.sendMessage(job.chatId, { 
            video: { url: filePath }, 
            caption 
        }, { quoted: job.baseMsg });
    }

    // 4. Limpieza y éxito
    try { fs.unlinkSync(filePath); } catch {}
    await conn.sendMessage(job.chatId, { react: { text: "✅", key: job.botMsg.key } });

  } catch (e) {
    console.error("Error enviando video:", e);
    await conn.sendMessage(job.chatId, { text: `❌ Falló la descarga: ${e.message}` }, { quoted: job.baseMsg });
  }
}

handler.command = ["y4", "yt4"];
export default handler;
