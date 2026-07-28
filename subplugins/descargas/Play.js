import { cabeceraDescarga, camposDescarga, pieDescarga, getMarca, canal, listaSegura } from "../../disenos.js";
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

// ==== API SKY ULTRA PLUS ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const API_RESOLVE = `${API_BASE}/youtube/resolve`;

// /youtube/resolve no responde hasta que el archivo está listo: por dentro
// sondea al servidor de descarga y, si ese falla, prueba otros. Eso puede
// tardar minutos, así que la espera aquí tiene que ser holgada.
const RESOLVE_TIMEOUT = 300000;
const DOWNLOAD_TIMEOUT = 300000;

// Defaults
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT = "mp3";
const MAX_MB = 200;

const VALID_QUALITIES = new Set(["144", "240", "360", "720"]);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pending = {};

// Todos los subbots comparten este módulo (mismo proceso Node): cada trabajo
// se marca con el subbot que lo creó y solo ese subbot lo procesa.
const __owner = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const __jobDe = (conn, id) => {
  const j = pending[id];
  return j && j.__own === __owner(conn) ? j : null;
};

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres:
// a esos usuarios no les salen los botones, se les manda la versión
// de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));


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

  const m = t.match(/\b(144|240|360|720)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];

  return "";
}

function splitQueryAndQuality(rawText = "") {
  const t = String(rawText || "").trim();
  if (!t) return { query: "", quality: "" };

  const parts = t.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();

  let q = "";

  const m = last.match(/^(144|240|360|720)p?$/i);
  if (m) q = m[1];

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

  if (isApiUrl(url)) headers["apikey"] = API_KEY;

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT,
    headers,
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);

  // Si llega HTML o JSON es una página de error, no el archivo.
  const tipo = String(res.headers?.["content-type"] || "");
  if (/text\/html|application\/json/i.test(tipo)) {
    try { res.data.destroy(); } catch {}
    throw new Error(`El enlace no devolvió un archivo (${tipo.split(";")[0]})`);
  }

  const esperado = Number(res.headers?.["content-length"] || 0);

  await streamPipe(res.data, fs.createWriteStream(filePath));

  // Si la conexión se corta a media descarga no salta ningún error: el archivo
  // queda incompleto y WhatsApp lo rechaza con "algo salió mal" al abrirlo.
  const real = fs.statSync(filePath).size;
  if (!real) throw new Error("El enlace devolvió un archivo vacío");
  if (esperado && real !== esperado) {
    throw new Error(`Descarga incompleta (${real} de ${esperado} bytes)`);
  }

  return filePath;
}

// ---------- formato real del archivo ----------
function cabecera(filePath, n = 12) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(n);

  try {
    fs.readSync(fd, buf, 0, n, 0);
  } finally {
    fs.closeSync(fd);
  }

  return buf;
}

// WhatsApp solo reproduce MP4. Un WebM renombrado a .mp4 se envía igual, pero
// al abrirlo sale "algo salió mal": por eso miramos la cabecera del archivo.
function esMp4(filePath) {
  try {
    return cabecera(filePath).slice(4, 8).toString("latin1") === "ftyp";
  } catch {
    return false;
  }
}

function formatoDeAudio(filePath) {
  try {
    const b = cabecera(filePath);

    if (b.slice(0, 3).toString("latin1") === "ID3") return "mp3";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";
    if (b.slice(4, 8).toString("latin1") === "ftyp") return "m4a";
    if (b.slice(0, 4).toString("latin1") === "OggS") return "ogg";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";

    return "";
  } catch {
    return "";
  }
}

// La API da varios enlaces para el mismo archivo. Si uno falla, o trae un
// formato que WhatsApp no reproduce, seguimos con el siguiente.
async function descargarMedia(urls, filePath, validar) {
  const respaldo = `${filePath}.alt`;
  let ultimoError;

  for (const url of urls) {
    try {
      await downloadToFile(url, filePath);

      if (!validar || validar(filePath)) return { formatoOk: true };

      // Se descargó bien pero en otro formato: lo guardamos por si ningún
      // otro enlace trae algo mejor.
      ultimoError = new Error("El enlace no devolvió un MP4");
      try { fs.unlinkSync(respaldo); } catch {}
      fs.renameSync(filePath, respaldo);
    } catch (e) {
      ultimoError = e;
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  if (fs.existsSync(respaldo)) {
    fs.renameSync(respaldo, filePath);
    return { formatoOk: false };
  }

  throw ultimoError || new Error("Sin enlaces de descarga");
}

// ---------- API ----------
// OJO: POST /youtube solo lista las calidades disponibles, no trae enlace.
// El que resuelve la descarga es POST /youtube/resolve.
function absolutizar(u) {
  if (!u || typeof u !== "string") return "";
  return u.startsWith("/") ? API_BASE + u : u;
}

// media llega como { direct, dl_inline, dl_download }: direct es el enlace del
// servidor de descarga y dl_download el proxy de la propia API (ruta relativa,
// pide apikey). Probamos el directo primero para no cargar tu servidor.
function mediaCandidatos(result) {
  const media = result?.media;

  if (typeof media === "string") return [absolutizar(media)].filter(Boolean);

  const urls = [
    absolutizar(media?.direct),
    absolutizar(media?.dl_download),
    absolutizar(media?.dl_inline),
    absolutizar(media?.url || media?.download),
    absolutizar(result?.url || result?.download)
  ];

  return [...new Set(urls.filter(Boolean))];
}

async function callYoutubeResolve(videoUrl, { type = "video", quality, format } = {}) {
  const esAudio = type === "audio";

  const body = esAudio
    ? { url: videoUrl, type: "audio", format: format || DEFAULT_AUDIO_FORMAT }
    : { url: videoUrl, type: "video", quality: quality || DEFAULT_VIDEO_QUALITY };

  const r = await axios.post(API_RESOLVE, body, {
    timeout: RESOLVE_TIMEOUT,
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

  if (!ok) throw new Error(data.message || data.error || `HTTP_${r.status}`);

  const result = data.result || data.data || data;
  const candidatos = mediaCandidatos(result);

  if (!candidatos.length) throw new Error("La API no devolvió enlace de descarga");

  return {
    title: result.title || "YouTube",
    thumbnail: result.thumbnail || result.cover || "",
    picked: result.picked || {},
    candidatos
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
      contextInfo: canal(),
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
      {
      contextInfo: canal(), text: "❌ Sin resultados." },
      { quoted: msg }
    );
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail, ago } = video;
  const viewsFmt = (views || 0).toLocaleString();
  const authorName = author?.name || author || "Desconocido";
  const chosenQuality = VALID_QUALITIES.has(quality) ? quality : DEFAULT_VIDEO_QUALITY;
  const qualityLabel = `${chosenQuality}p`;

  const usarBotones = botonesActivos() && !esIphone(msg);

  // Ficha con la info del resultado (va UNA sola vez, aquí)
  const fichaInfo = camposDescarga(conn, [
    ["Título", title],
    ["Canal", authorName],
    ["Duración", duration],
    ["Vistas", viewsFmt],
    ["Publicado", ago],
    ["Enlace", videoUrl]
  ]);

  const caption = usarBotones
    ? `
${cabeceraDescarga(conn, "🎬 RESULTADO ENCONTRADO")}

${fichaInfo}

🟢 *OPCIÓN 1 — Menú de descarga*
Toca el botón *📥 Menú de descarga* aquí abajo y elige la calidad.

🔵 *OPCIÓN 2 — Si el menú no te abre*
Cita este mensaje y escribe:
   *1* o *audio*      →  Audio MP3
   *2* o *video*      →  Video (${qualityLabel})
   *3* o *videodoc*   →  Video como documento
   *4* o *audiodoc*   →  Audio como documento

💡 *Tip:* cualquier calidad (144p a 720p) escribiendo:
   _"video 720"_   o   _"2 360"_   o   _"videodoc 240"_

${pieDescarga(conn)}
`.trim()
    : `
${cabeceraDescarga(conn, "🎬 RESULTADO ENCONTRADO")}

${fichaInfo}

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
   _"video 720"_   o   _"2 360"_   o   _"videodoc 240"_

${pieDescarga(conn)}
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
            { header: "", title: "🎬 Video 144p", description: "El más liviano · datos justos", id: `${pref}play_video_144` },
            { header: "", title: "🎬 Video 240p", description: "Liviano · para conexiones lentas", id: `${pref}play_video_240` },
            { header: "", title: "🎬 Video 360p", description: "Calidad estándar · recomendado", id: `${pref}play_video_360` },
            { header: "", title: "🎬 Video 720p", description: "HD · la mejor disponible", id: `${pref}play_video_720` }
          ]
        },
        {
          title: "📁 VIDEO COMO DOCUMENTO",
          highlight_label: "MP4",
          rows: [
            { header: "", title: "📁 Documento 144p", description: "Archivo mp4 · el más liviano", id: `${pref}play_videodoc_144` },
            { header: "", title: "📁 Documento 240p", description: "Archivo mp4 · liviano", id: `${pref}play_videodoc_240` },
            { header: "", title: "📁 Documento 360p", description: "Archivo mp4 · estándar", id: `${pref}play_videodoc_360` },
            { header: "", title: "📁 Documento 720p", description: "Archivo mp4 · HD", id: `${pref}play_videodoc_720` }
          ]
        }
      ]
    }
  ];

  // WhatsApp no abre la lista si se pasa de sus límites: la dejamos en regla
  const listaDescarga = listaSegura(nativeFlowButtons);

  let preview;

  if (usarBotones && listaDescarga) {
    try {
      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
      contextInfo: canal(),
          image: { url: thumbnail },
          caption,
          footer: "❦ Selecciona una opción del menú ❦",
          buttons: listaDescarga,
          headerType: 4
        },
        { quoted: msg }
      );
    } catch (e) {
      console.log("[play] menú nativo falló, usando fallback:", e.message);

      preview = await conn.sendMessage(
        msg.key.remoteJid,
        {
      contextInfo: canal(),
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
      contextInfo: canal(),
        image: { url: thumbnail },
        caption
      },
      { quoted: msg }
    );
  }

  pending[preview.key.id] = {
    __own: __owner(conn),
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
          const job = __jobDe(conn, reactKey.id);

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
              job = __jobDe(conn, ctxQuoted);
              if (!job) continue;
            } else {
              const jobsInChat = Object.entries(pending)
                .filter(([, j]) => j.chatId === m.key.remoteJid && j.__own === __owner(conn))
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

          const job = __jobDe(conn, citado);
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
      contextInfo: canal(),
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
      contextInfo: canal(),
                  text: `🎥 Descargando video (${useQuality + "p"})...`
                },
                { quoted: m }
              );

              await downloadVideo(conn, { ...job, videoQuality: useQuality }, docMode, m);
            } else {
              await conn.sendMessage(
                chatId,
                {
      contextInfo: canal(),
                  text:
`⚠️ *Opciones válidas:*
   • *1* o *audio* → audio mp3
   • *2* o *video* → video (puedes añadir calidad)
   • *3* o *videodoc* → video como documento
   • *4* o *audiodoc* → audio como documento

Ejemplos:
   • video 720
   • videodoc 360
   • 2 240`
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
      contextInfo: canal(),
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
      contextInfo: canal(),
        text: `🎶 Descargando audio como documento...`
      },
      { quoted: m }
    );

    return downloadAudio(conn, job, true, m);
  }

  const videoDocMatch = id.match(/play_videodoc_(\d+)$/i);

  if (videoDocMatch) {
    const q = videoDocMatch[1].toLowerCase();

    if (VALID_QUALITIES.has(q)) {
      const label = `${q}p`;

      await conn.sendMessage(chatId, {
        react: {
          text: "📁",
          key: m.key
        }
      });

      await conn.sendMessage(
        chatId,
        {
      contextInfo: canal(),
          text: `🎥 Descargando video como documento (${label})...`
        },
        { quoted: m }
      );

      return downloadVideo(conn, { ...job, videoQuality: q }, true, m);
    }
  }

  const videoMatch = id.match(/play_video_(\d+)$/i);

  if (videoMatch) {
    const q = videoMatch[1].toLowerCase();

    if (VALID_QUALITIES.has(q)) {
      const label = `${q}p`;

      await conn.sendMessage(chatId, {
        react: {
          text: "🎬",
          key: m.key
        }
      });

      await conn.sendMessage(
        chatId,
        {
      contextInfo: canal(),
          text: `🎥 Descargando video (${label})...`
        },
        { quoted: m }
      );

      return downloadVideo(conn, { ...job, videoQuality: q }, false, m);
    }
  }

  if (id === `${pref}play_video` || id.endsWith("play_video")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = `${q}p`;

    await conn.sendMessage(chatId, {
      react: {
        text: "🎬",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: `🎥 Descargando video (${label})...`
      },
      { quoted: m }
    );

    return downloadVideo(conn, job, false, m);
  }

  if (id === `${pref}play_videodoc` || id.endsWith("play_videodoc")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    const label = `${q}p`;

    await conn.sendMessage(chatId, {
      react: {
        text: "📁",
        key: m.key
      }
    });

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
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
      contextInfo: canal(),
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
      contextInfo: canal(),
      text: `⏳ Descargando video (${useQuality + "p"})...`
    },
    { quoted: quoted || job.commandMsg }
  );

  return downloadVideo(conn, job, isDoc, quoted || job.commandMsg);
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title, duration, viewsFmt, authorName } = job;

  let resolved;

  try {
    resolved = await callYoutubeResolve(videoUrl, {
      type: "audio",
      format: DEFAULT_AUDIO_FORMAT
    });
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: `❌ Error API (audio): ${e.message}`
      },
      { quoted }
    );
    return;
  }

  const mediaUrl = resolved.candidatos[0];

  if (!mediaUrl) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: "❌ No se pudo obtener audio."
      },
      { quoted }
    );
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const inFile = path.join(tmp, `${Date.now()}_audio.bin`);

  try {
    await descargarMedia(resolved.candidatos, inFile);
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

  // La API ya entrega el audio en mp3: volver a pasarlo por ffmpeg solo añadía
  // espera antes de enviarlo. Solo convertimos si llegó en otro formato.
  if (formatoDeAudio(inFile) === "mp3") {
    fs.renameSync(inFile, outMp3);
  } else {
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
  }

  const sizeMB = fileSizeMB(outFile);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(outFile);
    } catch {}

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: `❌ Audio > ${MAX_MB}MB.`
      },
      { quoted }
    );

    return;
  }


  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: { url: outFile },
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
      contextInfo: canal(),
        text: `❌ Error API (video): ${e.message}`
      },
      { quoted }
    );
    return;
  }

  const mediaUrl = resolved.candidatos[0];

  if (!mediaUrl) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: "❌ No se pudo obtener video."
      },
      { quoted }
    );
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const tag = `${q}p`;
  const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

  let estado;

  try {
    estado = await descargarMedia(resolved.candidatos, file, esMp4);
  } catch (e) {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: `❌ Error descargando video: ${e.message}`
      },
      { quoted }
    );
    return;
  }

  // Ningún enlace trajo un MP4: enviarlo como video daría "algo salió mal" al
  // abrirlo, así que va como documento.
  if (!estado.formatoOk) {
    asDocument = true;

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: "⚠️ La API no devolvió un MP4 en esta calidad, te lo mando como documento."
      },
      { quoted }
    );
  }

  const sizeMB = fileSizeMB(file);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(file);
    } catch {}

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: `❌ Video > ${MAX_MB}MB.`
      },
      { quoted }
    );

    return;
  }



  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: { url: file },
      mimetype: "video/mp4",
      fileName: `${base}_${tag}.mp4`,
    },
    { quoted }
  );

  try {
    fs.unlinkSync(file);
  } catch {}
}

handler.command = ["play"];

export default handler;
