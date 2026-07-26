// commands/xvideos.js — XVideos con opciones (👍 video / ❤️ documento o 1 / 2)
// ✅ Multiuso (10 minutos)
// ✅ Reacciones + respuestas citadas
// ✅ Branding: Suki Subbots + API Link
// ✅ SD por defecto, añade 'hd' para alta calidad

"use strict";

import { getMarca, canal } from "../../disenos.js";
import axios from 'axios';

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

// Jobs pendientes
const pendingXV = Object.create(null);

// Todos los subbots comparten este módulo (mismo proceso Node): cada trabajo
// se marca con el subbot que lo creó y solo ese subbot lo procesa.
const __owner = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const __mio = (conn, id) => {
  const j = pendingXV[id];
  return j && j.__own === __owner(conn) ? j : undefined;
};

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: a esos
// usuarios no se les mandan botones, se les da la versión de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));

// ---- helpers ----
function safeFileBase(title, def = "xvideos") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

function pickText(m) {
  return String(
    m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      ""
  ).trim();
}

function extractXVideosUrl(raw = "") {
  const t = String(raw || "").trim();

  // URL completa
  const m1 = t.match(/https?:\/\/[^\s]+/i);
  if (m1 && /xvideos\.com/i.test(m1[0])) return cleanupUrl(m1[0]);

  // sin http
  const m2 = t.match(/(?:www\.|m\.)?xvideos\.com\/[^\s]+/i);
  if (m2) return cleanupUrl("https://" + m2[0].replace(/^https?:\/\//i, ""));

  return "";
}

function cleanupUrl(u) {
  return String(u || "")
    .trim()
    .replace(/[)\],.]+$/g, "");
}

function normalizeInput(args, msg) {
  const raw = args?.length ? args.join(" ") : pickText(msg);
  const low = raw.toLowerCase();

  const isHd = /\bhd\b/.test(low);
  const url = extractXVideosUrl(raw);

  return { url, isHd };
}

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function unwrapApiResponse(data) {
  const root = data?.result ?? data?.data ?? data;
  return root?.data ?? root;
}

function pickLink(info) {
  return {
    hd:
      info?.high ||
      info?.hd ||
      info?.video_hd ||
      info?.media?.video_hd ||
      info?.media?.hd ||
      "",
    sd:
      info?.low ||
      info?.sd ||
      info?.video_sd ||
      info?.media?.video_sd ||
      info?.media?.sd ||
      "",
  };
}

async function getXVideosFromSky(url, wantHd) {
  const endpoint = `${API_BASE}/tools/xvideos`;

  const r = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  const http = r.status;
  let data = r.data;

  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error(`Respuesta no JSON del servidor (HTTP ${http})`); }
  }

  const ok =
    data?.status === true ||
    data?.status === "true" ||
    data?.ok === true ||
    data?.success === true;

  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const info = unwrapApiResponse(data);
  if (!info) throw new Error("API sin datos");

  const title = info?.title || info?.data?.title || "Video XVideos";
  const thumb = info?.thumb || info?.thumbnail || info?.image || null;

  const links = pickLink(info);

  let rawVideoUrl = "";
  let qualityLabel = "";

  if (wantHd) {
    rawVideoUrl = links.hd || links.sd;
    qualityLabel = links.hd ? "HD (Alta)" : "SD (Baja - HD no disponible)";
  } else {
    rawVideoUrl = links.sd || links.hd;
    qualityLabel = links.sd ? "SD (Baja)" : "HD (Alta - SD no disponible)";
  }

  if (!rawVideoUrl) throw new Error("No se encontró link descargable (sd/hd).");

  // proxy para descarga sin headers
  const proxyUrl = `${API_BASE}/tools/xvideos/dl?src=${encodeURIComponent(rawVideoUrl)}&filename=${encodeURIComponent(
    safeFileBase(title)
  )}&download=1`;

  return { title, thumb, quality: qualityLabel, proxy: proxyUrl, direct: rawVideoUrl };
}

async function sendMediaWithFallback(conn, chatId, quoted, caption, asDocument, urls) {
  // 1) proxy
  try {
    if (asDocument) {
      await conn.sendMessage(
        chatId,
        {
          document: { url: urls.proxy },
          mimetype: "video/mp4",
          fileName: `${safeFileBase("xvideos")}-${Date.now()}.mp4`,
          caption,
        },
        { quoted }
      );
    } else {
      await conn.sendMessage(
        chatId,
        {
      contextInfo: canal(), video: { url: urls.proxy }, mimetype: "video/mp4", caption },
        { quoted }
      );
    }
    return true;
  } catch {}

  // 2) directo
  if (asDocument) {
    await conn.sendMessage(
      chatId,
      {
        document: { url: urls.direct },
        mimetype: "video/mp4",
        fileName: `${safeFileBase("xvideos")}-${Date.now()}.mp4`,
        caption,
      },
      { quoted }
    );
  } else {
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), video: { url: urls.direct }, mimetype: "video/mp4", caption },
      { quoted }
    );
  }
  return true;
}

// Envío con feedback (igual estilo tt.js)
async function processSend(conn, job, asDocument, triggerMsg) {
  const { chatId, urls, caption, quotedBase } = job;

  try {
    await conn.sendMessage(chatId, {
      react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key },
    });

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `⏳ Espere, descargando video${asDocument ? " en documento" : ""}...` },
      { quoted: quotedBase }
    );

    await sendMediaWithFallback(conn, chatId, quotedBase, caption, asDocument, urls);

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
  } catch (e) {
    console.error("XV send error:", e?.message || e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
  } finally {
    job.isBusy = false;
  }
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = ((typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes) && (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)[0]) || ".";
  const { url, isHd } = normalizeInput(args, msg);

  if (!url) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text:
`🔞 *XVideos Downloader*

Modo Normal (SD):
${pref}${command} <enlace>

Modo Alta Calidad (HD):
${pref}${command} <enlace> hd

Ej:
${pref}${command} https://www.xvideos.com/videoXXXX hd`,
      },
      { quoted: msg }
    );
  }

  if (!/xvideos\.com/i.test(url)) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "❌ Enlace inválido de XVideos." }, { quoted: msg });
  }

  try {
    await react(conn, chatId, msg.key, "⏱️");

    const d = await getXVideosFromSky(url, isHd);

    const optionsText =
`⚡ 𝗫𝗩𝗶𝗱𝗲𝗼𝘀 — 𝗢𝗽𝗰𝗶𝗼𝗻𝗲𝘀

Elige cómo enviarlo:
👍 𝗩𝗶𝗱𝗲𝗼 (normal)
❤️ 𝗩𝗶𝗱𝗲𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— o responde: 1 = video · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${d.title}
✦ 𝗖𝗮𝗹𝗶𝗱𝗮𝗱: ${d.quality}

🤖 𝗕𝗼𝘁: ${getMarca(conn)}
🔗 𝗔𝗣𝗜: ${API_BASE}`;

    // Puedes mandar con thumb si quieres:
    const preview = d.thumb
      ? await conn.sendMessage(chatId, {
      contextInfo: canal(), image: { url: d.thumb }, caption: optionsText }, { quoted: msg })
      : await conn.sendMessage(chatId, {
      contextInfo: canal(), text: optionsText }, { quoted: msg });

    // Guardar job
    pendingXV[preview.key.id] = {
    __own: __owner(conn),
      chatId,
      urls: { proxy: d.proxy, direct: d.direct },
      caption:
`🔞 𝗫𝗩𝗶𝗱𝗲𝗼𝘀 — 𝗩𝗶𝗱𝗲𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${d.title}
✦ 𝗖𝗮𝗹𝗶𝗱𝗮𝗱: ${d.quality}

🤖 𝗕𝗼𝘁: ${getMarca(conn)}
🔗 𝗔𝗣𝗜: ${API_BASE}`,
      quotedBase: msg,
      isBusy: false
    };

    // Auto-borrado a los 10 minutos
    setTimeout(() => {
      if (pendingXV[preview.key.id]) delete pendingXV[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    // Listener único global (como play/tt)
    if (!conn._xvListener) {
      conn._xvListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // A) REACCIONES 👍 / ❤️
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = __mio(conn, reactKey.id);
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.isBusy) continue;
              job.isBusy = true;

              const asDoc = emoji === "❤️";
              await processSend(conn, job, asDoc, m);
              continue;
            }

            // B) RESPUESTAS 1/2 (citando el preview)
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && __mio(conn, replyTo)) {
              const job = __mio(conn, replyTo);
              if (job.chatId !== m.key.remoteJid) continue;

              const textLow = String(
                m.message?.conversation || m.message?.extendedTextMessage?.text || ""
              ).trim().toLowerCase();

              if (textLow !== "1" && textLow !== "2") continue;

              if (job.isBusy) continue;
              job.isBusy = true;

              const asDoc = textLow === "2";
              await processSend(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("XV listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error en xvideos:", err?.message || err);

    const em = String(err?.message || "");
    let txt = "❌ Error al procesar el video.";
    if (/invalid_api_key|apikey|401/i.test(em)) txt = "🔐 API Key inválida o no autorizada.";
    else if (/404/i.test(em)) txt = "❌ Endpoint no existe (404). Revisa /tools/xvideos y /tools/xvideos/dl.";
    else if (em) txt = `❌ Error: ${em}`;

    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: txt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

handler.command = ["xvideos", "xv"];
handler.help = ["xvideos <url> [hd]", "xv <url> [hd]"];
handler.tags = ["nsfw", "dl"];
handler.register = true;

export default handler;
