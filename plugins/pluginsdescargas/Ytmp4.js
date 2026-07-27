import { cabeceraDescarga, pieDescarga, getMarca, canal, listaSegura } from "../../disenos.js";
import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// comandos/ytmp4.js — YouTube MP4 (URL)
// ✅ Mensaje de opciones: solo explicación de descarga
// ✅ Info del video: va con el archivo descargado
// ✅ Respeta activoss.json (sistema de activar/desactivar botones)
// ✅ Soporta Reacciones, Menú Interactivo y Respuestas Citadas

"use strict";

import axios from 'axios';
import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== CONFIG DE TU API ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const DEFAULT_VIDEO_QUALITY = "360";
const MAX_MB = 200;
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pending = {};

// ---------- utils ----------
function safeName(name = "video") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "video"
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
    try { fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2)); } catch {}
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

function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();
  if (t.includes("4k")) return "4k";
  const m = t.match(/\b(144|240|360|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];
  return "";
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
    Accept: "*/*",
  };
  if (isApiUrl(url)) headers["apikey"] = API_KEY;

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// ---------- API ----------
async function callYoutubeResolveVideo(videoUrl, quality) {
  const endpoint = `${API_BASE}/youtube/resolve`;
  const body = { url: videoUrl, type: "video", quality: quality || DEFAULT_VIDEO_QUALITY };

  const r = await axios.post(endpoint, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Accept: "application/json, */*",
    },
    validateStatus: () => true,
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok = data.status === true || data.status === "true" || data.ok === true || data.success === true;
  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;
  if (!result?.media) throw new Error("API sin media");

  let dl = result.media.dl_download || "";
  if (dl && typeof dl === "string" && dl.startsWith("/")) dl = API_BASE + dl;

  const direct = result.media.direct || "";

  return {
    title: result.title || "YouTube Video",
    thumbnail: result.thumbnail || "",
    dl_download: dl,
    direct,
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
    return conn.sendMessage(msg.key.remoteJid, {
      contextInfo: canal(), text: "❌ Enlace inválido." }, { quoted: msg });
  }

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

  // Buscar info del video con yt-search (se guarda para el caption final)
  let title = "YouTube Video";
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

  const chosenQuality = DEFAULT_VIDEO_QUALITY;
  const qualityLabel = chosenQuality === "4k" ? "4K" : `${chosenQuality}p`;

  const usarBotones = botonesActivos() && !esIphone(msg);

  // 🎨 Caption LIMPIO — solo explicación + marca de agua
  const caption = usarBotones
    ? `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟢 *OPCIÓN 1 — Menú de descarga*
Toca el botón *📥 Menú de descarga* aquí abajo y elige la calidad.

🔵 *OPCIÓN 2 — Si el menú no te abre*
Cita este mensaje y escribe:
   *1* o *video*      →  Video (${qualityLabel})
   *2* o *videodoc*   →  Video como documento

💡 *Tip:* cualquier calidad (144p a 4K) escribiendo:
   _"video 720"_   o   _"videodoc 4k"_

${pieDescarga(conn)}
`.trim()
    : `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Video (${qualityLabel})
   📁  →  Video como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1* o *video*      →  Video (${qualityLabel})
   *2* o *videodoc*   →  Video como documento

💡 *Tip:* Puedes cambiar la calidad escribiendo:
   _"video 720"_   o   _"2 1080"_   o   _"videodoc 4k"_

${pieDescarga(conn)}
`.trim();

  // ====== MENÚ INTERACTIVO ======
  const nativeFlowButtons = [
    {
      text: "📥 Menú de descarga",
      sections: [
        {
          title: "🎬 VIDEO NORMAL",
          highlight_label: "MP4",
          rows: [
            { header: "", title: "🎬 Video 240p",  description: "Liviano · para conexiones lentas",   id: `${pref}ytmp4_video_240`  },
            { header: "", title: "🎬 Video 360p",  description: "Calidad estándar · recomendado",     id: `${pref}ytmp4_video_360`  },
            { header: "", title: "🎬 Video 720p",  description: "HD · buena calidad",                 id: `${pref}ytmp4_video_720`  },
            { header: "", title: "🎬 Video 1080p", description: "Full HD · alta calidad",             id: `${pref}ytmp4_video_1080` },
            { header: "", title: "🎬 Video 4K",    description: "Ultra HD · archivo pesado",          id: `${pref}ytmp4_video_4k`   },
          ],
        },
        {
          title: "📁 VIDEO COMO DOCUMENTO",
          highlight_label: "MP4",
          rows: [
            { header: "", title: "📁 Documento 240p",  description: "Archivo mp4 · liviano",      id: `${pref}ytmp4_videodoc_240`  },
            { header: "", title: "📁 Documento 360p",  description: "Archivo mp4 · estándar",     id: `${pref}ytmp4_videodoc_360`  },
            { header: "", title: "📁 Documento 720p",  description: "Archivo mp4 · HD",           id: `${pref}ytmp4_videodoc_720`  },
            { header: "", title: "📁 Documento 1080p", description: "Archivo mp4 · Full HD",      id: `${pref}ytmp4_videodoc_1080` },
            { header: "", title: "📁 Documento 4K",    description: "Archivo mp4 · Ultra HD",     id: `${pref}ytmp4_videodoc_4k`   },
          ],
        },
      ],
    },
  ];

  // WhatsApp no abre la lista si se pasa de sus límites: la dejamos en regla
  const listaDescarga = listaSegura(nativeFlowButtons);

  // Enviar con o sin botones
  let preview;
  if (usarBotones && listaDescarga) {
    try {
      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
      contextInfo: canal(),
          image: thumbnail ? { url: thumbnail } : undefined,
          caption,
          footer: "❦ Selecciona una opción del menú ❦",
          buttons: listaDescarga,
          headerType: 4,
        },
        { quoted: msg }
      );
    } catch (e) {
      console.log("[ytmp4] menú nativo falló, usando fallback:", e.message);
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

  // Guardar TODA la info para el caption final
  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl: url,
    title,
    thumbnail,
    duration,
    viewsFmt,
    authorName,
    commandMsg: msg,
    videoQuality: chosenQuality,
    _createdAt: Date.now(),
  };
  setTimeout(() => { delete pending[preview.key.id]; }, 10 * 60 * 1000);

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

  // ====== Listener único ======
  if (!conn._ytmp4ProListener) {
    conn._ytmp4ProListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) await handleReaction(conn, job, emoji, job.commandMsg);
          continue;
        }

        // 2) RESPUESTAS DEL MENÚ INTERACTIVO
        try {
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.listResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            null;

          if (interactiveReply) {
            let selectedId = "";

            if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
              selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            } else if (interactiveReply?.paramsJson) {
              try {
                const params = JSON.parse(interactiveReply.paramsJson);
                selectedId = params.id || "";
              } catch {}
            } else if (interactiveReply?.body?.text) {
              selectedId = interactiveReply.body.text;
            }

            if (!selectedId) continue;
            // Solo IDs propios de ytmp4
            if (!selectedId.includes("ytmp4_")) continue;

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
          console.error("[ytmp4] error menú:", e);
        }

        // 3) RESPUESTAS CITADAS
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          const texto = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
          const job = pending[citado];
          const chatId = m.key.remoteJid;

          if (citado && job) {
            const qFromReply = extractQualityFromText(texto);
            const firstWord = texto.split(/\s+/)[0];

            if (["1", "video", "2", "videodoc"].includes(firstWord)) {
              const docMode = firstWord === "2" || firstWord === "videodoc";
              const useQuality = VALID_QUALITIES.has(qFromReply) ? qFromReply : (job.videoQuality || DEFAULT_VIDEO_QUALITY);
              const lbl = useQuality === "4k" ? "4K" : `${useQuality}p`;

              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `🎥 Descargando video (${lbl})${docMode ? " como documento" : ""}...` }, { quoted: m });
              await downloadVideo(conn, { ...job, videoQuality: useQuality }, docMode, m);
            }
          }
        } catch (e) {}
      }
    });
  }
};

// ====== Manejar selección del menú ======
async function handleMenuSelection(conn, job, selectedId, m, pref) {
  const chatId = m.key.remoteJid;
  const id = String(selectedId).trim();

  // Documento con calidad específica
  const videoDocMatch = id.match(/ytmp4_videodoc_(\d+|4k)$/i);
  if (videoDocMatch) {
    const q = videoDocMatch[1].toLowerCase();
    if (VALID_QUALITIES.has(q)) {
      const label = q === "4k" ? "4K" : `${q}p`;
      await conn.sendMessage(chatId, { react: { text: "📁", key: m.key } });
      await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `🎥 Descargando video como documento (${label})...` }, { quoted: m });
      return downloadVideo(conn, { ...job, videoQuality: q }, true, m);
    }
  }

  // Video normal con calidad específica
  const videoMatch = id.match(/ytmp4_video_(\d+|4k)$/i);
  if (videoMatch) {
    const q = videoMatch[1].toLowerCase();
    if (VALID_QUALITIES.has(q)) {
      const label = q === "4k" ? "4K" : `${q}p`;
      await conn.sendMessage(chatId, { react: { text: "🎬", key: m.key } });
      await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `🎥 Descargando video (${label})...` }, { quoted: m });
      return downloadVideo(conn, { ...job, videoQuality: q }, false, m);
    }
  }

  // Fallback genérico
  if (id === `${pref}ytmp4_video` || id.endsWith("ytmp4_video")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = q === "4k" ? "4K" : `${q}p`;
    await conn.sendMessage(chatId, { react: { text: "🎬", key: m.key } });
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `🎥 Descargando video (${label})...` }, { quoted: m });
    return downloadVideo(conn, job, false, m);
  }

  if (id === `${pref}ytmp4_videodoc` || id.endsWith("ytmp4_videodoc")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = q === "4k" ? "4K" : `${q}p`;
    await conn.sendMessage(chatId, { react: { text: "📁", key: m.key } });
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `🎥 Descargando video como documento (${label})...` }, { quoted: m });
    return downloadVideo(conn, job, true, m);
  }
}

// ====== Manejar reacciones ======
async function handleReaction(conn, job, emoji, quoted) {
  const useQuality = job.videoQuality || DEFAULT_VIDEO_QUALITY;
  const label = useQuality === "4k" ? "4K" : `${useQuality}p`;

  if (emoji === "👍" || emoji === "❤️") {
    await conn.sendMessage(job.chatId, {
      contextInfo: canal(), text: `⏳ Descargando video (${label})...` }, { quoted });
    return downloadVideo(conn, job, false, quoted);
  }
  if (emoji === "📁") {
    await conn.sendMessage(job.chatId, {
      contextInfo: canal(), text: `⏳ Descargando video como documento (${label})...` }, { quoted });
    return downloadVideo(conn, job, true, quoted);
  }
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title, duration, viewsFmt, authorName } = job;
  const q = VALID_QUALITIES.has(job.videoQuality) ? job.videoQuality : DEFAULT_VIDEO_QUALITY;

  let resolved;
  try {
    resolved = await callYoutubeResolveVideo(videoUrl, q);
  } catch (e) {
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error API (video): ${e.message}` }, { quoted });
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;
  if (!mediaUrl) {
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: "❌ No se pudo obtener video." }, { quoted });
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const tag = q === "4k" ? "4k" : `${q}p`;
  const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

  await downloadToFile(mediaUrl, file);

  const sizeMB = fileSizeMB(file);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(file); } catch {}
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Video > ${MAX_MB}MB. Prueba con calidad menor.` }, { quoted });
    return;
  }

  // 🎨 Caption final con TODA la info + marca de agua
  const qualityLabel = q === "4k" ? "4K" : `${q}p`;
  const finalCaption =
`╭━━━━━━━━━━━━━━━━━╮
   🎬 𝗩𝗜𝗗𝗘𝗢 𝗗𝗘𝗦𝗖𝗔𝗥𝗚𝗔𝗗𝗢
╰━━━━━━━━━━━━━━━━━━╯

📝 *Título:* ${title}
👤 *Autor:* ${authorName}
⏱️ *Duración:* ${duration}
👁️ *Vistas:* ${viewsFmt}
⚡ *Calidad:* ${qualityLabel}
📦 *Formato:* ${asDocument ? "Documento MP4" : "Video MP4"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

━━━━━━━━━━━━━━━━━
🤖 *Bot:* ${getMarca(conn)}
🔗 *API:* ${API_BASE}
━━━━━━━━━━━━━━━━━━`;

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${base}_${tag}.mp4`,
      caption: finalCaption,
    },
    { quoted }
  );

  try { fs.unlinkSync(file); } catch {}
}

handler.command = ["ytmp4", "ytv", "yt4"];
handler.help = ["ytmp4 <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
