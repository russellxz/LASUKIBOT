import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
"use strict";

import axios from 'axios';
import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// ==== API VIEJA PARA VIDEO ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";

// ==== NEOXR API SOLO PARA MP3 ====
const NEOXR_API_BASE = "https://api.neoxr.eu/api";
const NEOXR_API_KEY = "russellxz";
const NEOXR_AUDIO_QUALITY = "128kbps";

// Defaults
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT = "mp3";
const MAX_MB = 200;

const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pending = {};

// ---------- utils ----------
function safeName(name = "file") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file"
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

function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();
  if (t.includes("4k")) return "4k";

  const m = t.match(/\b(144|240|360|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];

  return "";
}

function splitQueryAndQuality(rawText = "") {
  const t = String(rawText || "").trim();
  if (!t) return { query: "", quality: "" };

  const parts = t.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();

  let q = "";

  if (last === "4k") {
    q = "4k";
  } else {
    const m = last.match(/^(144|240|360|720|1080|1440)p?$/i);
    if (m) q = m[1];
  }

  if (q) {
    parts.pop();
    return {
      query: parts.join(" ").trim(),
      quality: q
    };
  }

  return {
    query: t,
    quality: ""
  };
}

function isSkyApiUrl(url = "") {
  try {
    const u = new URL(url);
    const b = new URL(API_BASE);
    return u.host === b.host;
  } catch {
    return false;
  }
}

function isNeoxrApiUrl(url = "") {
  try {
    const u = new URL(url);
    const b = new URL(NEOXR_API_BASE);
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

  if (isSkyApiUrl(url)) headers["apikey"] = API_KEY;
  if (isNeoxrApiUrl(url)) headers["apikey"] = NEOXR_API_KEY;

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

function deepFindUrl(obj) {
  const found = [];

  function walk(value) {
    if (!value) return;

    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) found.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value === "object") {
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  }

  walk(obj);

  return found.find(u =>
    /\.(mp3|m4a|webm|opus|ogg)(\?|$)/i.test(u) ||
    /download|audio|youtube|cdn|media/i.test(u)
  ) || found[0] || "";
}

// ---------- API VIDEO VIEJA ----------
async function callYoutubeResolve(videoUrl, { type, quality, format }) {
  const endpoint = `${API_BASE}/youtube/resolve`;

  const body =
    type === "video"
      ? {
          url: videoUrl,
          type: "video",
          quality: quality || DEFAULT_VIDEO_QUALITY
        }
      : {
          url: videoUrl,
          type: "audio",
          format: format || DEFAULT_AUDIO_FORMAT
        };

  const r = await axios.post(endpoint, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Accept: "application/json, */*"
    },
    validateStatus: () => true
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;
  if (!result?.media) throw new Error("API sin media");

  let dl = result.media.dl_download || "";

  if (dl && typeof dl === "string" && dl.startsWith("/")) {
    dl = API_BASE + dl;
  }

  const direct = result.media.direct || "";

  return {
    title: result.title || "YouTube",
    thumbnail: result.thumbnail || "",
    picked: result.picked || {},
    dl_download: dl,
    direct
  };
}

// ---------- NEOXR API AUDIO MP3 ----------
async function callNeoxrAudio(videoUrl) {
  const r = await axios.get(`${NEOXR_API_BASE}/youtube`, {
    timeout: 120000,
    params: {
      url: videoUrl,
      type: "audio",
      quality: NEOXR_AUDIO_QUALITY,
      apikey: NEOXR_API_KEY
    },
    headers: {
      Accept: "application/json, */*"
    },
    validateStatus: () => true
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON de Neoxr");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true ||
    data.creator ||
    data.result ||
    data.data;

  if (!ok) {
    throw new Error(data.message || data.error || "Error en Neoxr API");
  }

  const result = data.result || data.data || data;

  let mediaUrl =
    result.url ||
    result.download ||
    result.download_url ||
    result.dl ||
    result.audio ||
    result.audio_url ||
    result.link ||
    result.media ||
    result.file ||
    result?.data?.url ||
    result?.data?.download ||
    result?.data?.audio ||
    "";

  if (!mediaUrl || typeof mediaUrl !== "string") {
    mediaUrl = deepFindUrl(data);
  }

  if (!mediaUrl) {
    throw new Error("Neoxr no devolvió link de audio");
  }

  return {
    title: result.title || data.title || "YouTube",
    thumbnail: result.thumbnail || result.thumb || data.thumbnail || "",
    dl_download: mediaUrl,
    direct: mediaUrl
  };
}

// ---------- main ----------
const handler = async (msg, { conn, text }) => {
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  const { query, quality } = splitQueryAndQuality(text);

  if (!query) {
    return conn.sendMessage(
      msg.key.remoteJid,
      {
        text: `✳️ Usa:\n${pref}play <término> [calidad]\nEj: *${pref}play* bad bunny diles 720`
      },
      { quoted: msg }
    );
  }

  await conn.sendMessage(msg.key.remoteJid, {
    react: {
      text: "⏳",
      key: msg.key
    }
  });

  const res = await yts(query);
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
  const authorName = author?.name || author || "Desconocido";
  const chosenQuality = VALID_QUALITIES.has(quality) ? quality : DEFAULT_VIDEO_QUALITY;
  const qualityLabel = chosenQuality === "4k" ? "4K" : `${chosenQuality}p`;

  const usarBotones = botonesActivos();

  const caption = usarBotones
    ? `
╭━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟢 *OPCIÓN 1 — Menú de Botones*
Toca el botón *📥 Menú de descarga* abajo del mensaje. Se abrirá una lista con todas las opciones de audio y video en distintas calidades.

━━━━━━━━━━━━━━━━━
🤖 *Suki Subbots*
━━━━━━━━━━━━━━━━━
`.trim()
    : `
╭━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Audio MP3
   ❤️  →  Video (${qualityLabel})
   📄  →  Audio como documento
   📁  →  Video como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1* o *audio*      →  Audio MP3
   *2* o *video*      →  Video (${qualityLabel})
   *3* o *videodoc*   →  Video como documento
   *4* o *audiodoc*   →  Audio como documento

💡 *Tip:* Puedes cambiar la calidad escribiendo:
   _"video 720"_   o   _"2 1080"_   o   _"videodoc 4k"_

━━━━━━━━━━━━━━━
🤖 *Suki Subbots*
━━━━━━━━━━━━━━━
`.trim();

  const nativeFlowButtons = [
    {
      text: "📥 Menú de descarga",
      sections: [
        {
          title: "🎵 AUDIO",
          highlight_label: "MP3",
          rows: [
            {
              header: "",
              title: "🎵 Audio MP3",
              description: "Descargar como nota de audio reproducible",
              id: `${pref}play_audio`
            },
            {
              header: "",
              title: "📄 Audio como Documento",
              description: "Descargar como archivo mp3 descargable",
              id: `${pref}play_audiodoc`
            }
          ]
        },
        {
          title: "🎬 VIDEO NORMAL",
          highlight_label: qualityLabel,
          rows: [
            { header: "", title: "🎬 Video 144p", description: "Muy liviano · pocos MB", id: `${pref}play_video_144` },
            { header: "", title: "🎬 Video 240p", description: "Liviano · para conexiones lentas", id: `${pref}play_video_240` },
            { header: "", title: "🎬 Video 360p", description: "Calidad estándar · recomendado", id: `${pref}play_video_360` },
            { header: "", title: "🎬 Video 720p", description: "HD · buena calidad", id: `${pref}play_video_720` },
            { header: "", title: "🎬 Video 1080p", description: "Full HD · alta calidad", id: `${pref}play_video_1080` },
            { header: "", title: "🎬 Video 1440p", description: "2K · muy alta calidad", id: `${pref}play_video_1440` },
            { header: "", title: "🎬 Video 4K", description: "Ultra HD · archivo pesado", id: `${pref}play_video_4k` }
          ]
        },
        {
          title: "📁 VIDEO COMO DOCUMENTO",
          highlight_label: "MP4",
          rows: [
            { header: "", title: "📁 Documento 144p", description: "Archivo mp4 · muy liviano", id: `${pref}play_videodoc_144` },
            { header: "", title: "📁 Documento 240p", description: "Archivo mp4 · liviano", id: `${pref}play_videodoc_240` },
            { header: "", title: "📁 Documento 360p", description: "Archivo mp4 · estándar", id: `${pref}play_videodoc_360` },
            { header: "", title: "📁 Documento 720p", description: "Archivo mp4 · HD", id: `${pref}play_videodoc_720` },
            { header: "", title: "📁 Documento 1080p", description: "Archivo mp4 · Full HD", id: `${pref}play_videodoc_1080` },
            { header: "", title: "📁 Documento 1440p", description: "Archivo mp4 · 2K", id: `${pref}play_videodoc_1440` },
            { header: "", title: "📁 Documento 4K", description: "Archivo mp4 · Ultra HD", id: `${pref}play_videodoc_4k` }
          ]
        }
      ]
    }
  ];

  let preview;

  if (usarBotones) {
    try {
      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
          image: { url: thumbnail },
          caption,
          footer: "❦ Selecciona una opción del menú ❦",
          buttons: nativeFlowButtons,
          headerType: 4
        },
        { quoted: msg }
      );
    } catch (e) {
      console.log("[play] menú nativo falló, usando fallback:", e.message);

      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
          image: { url: thumbnail },
          caption
        },
        { quoted: msg }
      );
    }
  } else {
    preview = await conn.sendMessage(
      msg.key.remoteJid,
      {
        image: { url: thumbnail },
        caption
      },
      { quoted: msg }
    );
  }

  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl,
    title,
    thumbnail,
    duration,
    views,
    viewsFmt,
    authorName,
    commandMsg: msg,
    videoQuality: chosenQuality,
    _createdAt: Date.now()
  };

  await conn.sendMessage(msg.key.remoteJid, {
    react: {
      text: "✅",
      key: msg.key
    }
  });

  if (!conn._playproListener) {
    conn._playproListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];

          if (job) await handleDownload(conn, job, emoji, job.commandMsg);
          continue;
        }

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

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;

            if (ctxQuoted && pending[ctxQuoted]) {
              job = pending[ctxQuoted];
            } else {
              const jobsInChat = Object.entries(pending)
                .filter(([, j]) => j.chatId === m.key.remoteJid)
                .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));

              if (jobsInChat.length > 0) {
                job = jobsInChat[0][1];
              }
            }

            if (!job) continue;

            await handleMenuSelection(conn, job, selectedId, m, pref);
            continue;
          }
        } catch (e) {
          console.error("[play] error menú:", e);
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
            const qFromReply = extractQualityFromText(texto);
            const firstWord = texto.split(/\s+/)[0];

            if (["1", "audio", "4", "audiodoc"].includes(firstWord)) {
              const docMode = firstWord === "4" || firstWord === "audiodoc";

              await conn.sendMessage(chatId, {
                react: {
                  text: docMode ? "📄" : "🎵",
                  key: m.key
                }
              });

              await conn.sendMessage(
                chatId,
                {
                  text: `🎶 Descargando audio (mp3)...`
                },
                { quoted: m }
              );

              await downloadAudio(conn, job, docMode, m);
            } else if (["2", "video", "3", "videodoc"].includes(firstWord)) {
              const docMode = firstWord === "3" || firstWord === "videodoc";
              const useQuality = VALID_QUALITIES.has(qFromReply)
                ? qFromReply
                : job.videoQuality || DEFAULT_VIDEO_QUALITY;

              await conn.sendMessage(chatId, {
                react: {
                  text: docMode ? "📁" : "🎬",
                  key: m.key
                }
              });

              await conn.sendMessage(
                chatId,
                {
                  text: `🎥 Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...`
                },
                { quoted: m }
              );

              await downloadVideo(conn, { ...job, videoQuality: useQuality }, docMode, m);
            } else {
              await conn.sendMessage(
                chatId,
                {
                  text:
`⚠️ *Opciones válidas:*
   • *1* o *audio* → audio mp3
   • *2* o *video* → video (puedes añadir calidad)
   • *3* o *videodoc* → video como documento
   • *4* o *audiodoc* → audio como documento

Ejemplos:
   • video 720
   • videodoc 1080
   • 2 4k`
                },
                { quoted: m }
              );
            }

            if (!job._timer) {
              job._timer = setTimeout(() => delete pending[citado], 10 * 60 * 1000);
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

  if (id === `${pref}play_audio` || id.endsWith("play_audio")) {
    await conn.sendMessage(chatId, {
      react: {
        text: "🎵",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
        text: `🎶 Descargando audio (mp3)...`
      },
      { quoted: m }
    );

    return downloadAudio(conn, job, false, m);
  }

  if (id === `${pref}play_audiodoc` || id.endsWith("play_audiodoc")) {
    await conn.sendMessage(chatId, {
      react: {
        text: "📄",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
        text: `🎶 Descargando audio como documento...`
      },
      { quoted: m }
    );

    return downloadAudio(conn, job, true, m);
  }

  const videoDocMatch = id.match(/play_videodoc_(\d+|4k)$/i);

  if (videoDocMatch) {
    const q = videoDocMatch[1].toLowerCase();

    if (VALID_QUALITIES.has(q)) {
      const label = q === "4k" ? "4K" : `${q}p`;

      await conn.sendMessage(chatId, {
        react: {
          text: "📁",
          key: m.key
        }
      });

      await conn.sendMessage(
        chatId,
        {
          text: `🎥 Descargando video como documento (${label})...`
        },
        { quoted: m }
      );

      return downloadVideo(conn, { ...job, videoQuality: q }, true, m);
    }
  }

  const videoMatch = id.match(/play_video_(\d+|4k)$/i);

  if (videoMatch) {
    const q = videoMatch[1].toLowerCase();

    if (VALID_QUALITIES.has(q)) {
      const label = q === "4k" ? "4K" : `${q}p`;

      await conn.sendMessage(chatId, {
        react: {
          text: "🎬",
          key: m.key
        }
      });

      await conn.sendMessage(
        chatId,
        {
          text: `🎥 Descargando video (${label})...`
        },
        { quoted: m }
      );

      return downloadVideo(conn, { ...job, videoQuality: q }, false, m);
    }
  }

  if (id === `${pref}play_video` || id.endsWith("play_video")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = q === "4k" ? "4K" : `${q}p`;

    await conn.sendMessage(chatId, {
      react: {
        text: "🎬",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
        text: `🎥 Descargando video (${label})...`
      },
      { quoted: m }
    );

    return downloadVideo(conn, job, false, m);
  }

  if (id === `${pref}play_videodoc` || id.endsWith("play_videodoc")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = q === "4k" ? "4K" : `${q}p`;

    await conn.sendMessage(chatId, {
      react: {
        text: "📁",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
        text: `🎥 Descargando video como documento (${label})...`
      },
      { quoted: m }
    );

    return downloadVideo(conn, job, true, m);
  }
}

// ====== Manejar reacciones ======
async function handleDownload(conn, job, choice, quoted) {
  const mapping = {
    "👍": "audio",
    "❤️": "video",
    "📄": "audioDoc",
    "📁": "videoDoc"
  };

  const key = mapping[choice];
  if (!key) return;

  const isDoc = key.endsWith("Doc");

  if (key.startsWith("audio")) {
    await conn.sendMessage(
      job.chatId,
      {
        text: `⏳ Descargando audio (mp3)...`
      },
      { quoted: quoted || job.commandMsg }
    );

    return downloadAudio(conn, job, isDoc, quoted || job.commandMsg);
  }

  const useQuality = job.videoQuality || DEFAULT_VIDEO_QUALITY;

  await conn.sendMessage(
    job.chatId,
    {
      text: `⏳ Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...`
    },
    { quoted: quoted || job.commandMsg }
  );

  return downloadVideo(conn, job, isDoc, quoted || job.commandMsg);
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title, duration, viewsFmt, authorName } = job;

  let resolved;

  try {
    resolved = await callNeoxrAudio(videoUrl);
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
        text: `❌ Error Neoxr API (audio): ${e.message}`
      },
      { quoted }
    );
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;

  if (!mediaUrl) {
    await conn.sendMessage(
      chatId,
      {
        text: "❌ No se pudo obtener audio."
      },
      { quoted }
    );
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const inFile = path.join(tmp, `${Date.now()}_neoxr_audio.bin`);

  try {
    await downloadToFile(mediaUrl, inFile);
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
        text: `❌ Error descargando audio: ${e.message}`
      },
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
        text: `❌ Audio > ${MAX_MB}MB.`
      },
      { quoted }
    );

    return;
  }

  const finalCaption =
`╭━━━━━━━━━━━━━━━━━━╮
   🎵 𝗔𝗨𝗗𝗜𝗢 𝗗𝗘𝗦𝗖𝗔𝗥𝗚𝗔𝗗𝗢
╰━━━━━━━━━━━━━━━━━━╯

📝 *Título:* ${title}
👤 *Autor:* ${authorName}
⏱️ *Duración:* ${duration}
👁️ *Vistas:* ${viewsFmt}
📦 *Formato:* ${asDocument ? "Documento MP3" : "Audio MP3"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

━━━━━━━━━━━━━━━━━━━━
🤖 *Bot:* Suki Subbots
🔗 *API:* Neoxr API
━━━━━━━━━━━━━━━━━━━━`;

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: fs.readFileSync(outFile),
      mimetype: "audio/mpeg",
      fileName: `${base}.mp3`,
      caption: asDocument ? finalCaption : undefined
    },
    { quoted }
  );

  if (!asDocument) {
    await conn.sendMessage(
      chatId,
      {
        text: finalCaption
      },
      { quoted }
    );
  }

  try {
    fs.unlinkSync(outFile);
  } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title, duration, viewsFmt, authorName } = job;
  const q = VALID_QUALITIES.has(job.videoQuality) ? job.videoQuality : DEFAULT_VIDEO_QUALITY;

  let resolved;

  try {
    resolved = await callYoutubeResolve(videoUrl, {
      type: "video",
      quality: q
    });
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
        text: `❌ Error API (video): ${e.message}`
      },
      { quoted }
    );
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;

  if (!mediaUrl) {
    await conn.sendMessage(
      chatId,
      {
        text: "❌ No se pudo obtener video."
      },
      { quoted }
    );
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const tag = q === "4k" ? "4k" : `${q}p`;
  const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

  await downloadToFile(mediaUrl, file);

  const sizeMB = fileSizeMB(file);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(file);
    } catch {}

    await conn.sendMessage(
      chatId,
      {
        text: `❌ Video > ${MAX_MB}MB.`
      },
      { quoted }
    );

    return;
  }

  const qualityLabel = q === "4k" ? "4K" : `${q}p`;

  const finalCaption =
`╭━━━━━━━━━━━━━━╮
   🎬 𝗩𝗜𝗗𝗘𝗢 𝗗𝗘𝗦𝗖𝗔𝗥𝗚𝗔𝗗𝗢
╰━━━━━━━━━━━━━━━╯

📝 *Título:* ${title}
👤 *Autor:* ${authorName}
⏱️ *Duración:* ${duration}
👁️ *Vistas:* ${viewsFmt}
⚡ *Calidad:* ${qualityLabel}
📦 *Formato:* ${asDocument ? "Documento MP4" : "Video MP4"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

━━━━━━━━━━━━━━━━━━
🤖 *Bot:* Suki Subbots
🔗 *API:* ${API_BASE}
━━━━━━━━━━━━━━━━━━`;

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${base}_${tag}.mp4`,
      caption: finalCaption
    },
    { quoted }
  );

  try {
    fs.unlinkSync(file);
  } catch {}
}

handler.command = ["play"];

export default handler;
