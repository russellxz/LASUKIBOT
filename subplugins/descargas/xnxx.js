
// commands/xnxx.js — XNXX/TXNHH interactivo (👍 normal / ❤️ documento o 1/2) usando tu API
"use strict";

import axios from 'axios';

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY || "Russellxz";

const MAX_TIMEOUT = 25000;

// ---- helpers ----
const fmtSec = (s) => {
  const n = Number(s || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = Math.floor(n % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

function safeFileBase(title, def = "xnxx") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

function normalizeInputUrl(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  // si pegan www. sin protocolo
  if (!/^https?:\/\//i.test(t) && /^www\./i.test(t)) t = "https://" + t;
  return t;
}

function isSupportedHost(hostname) {
  const host = String(hostname || "").toLowerCase();

  // XNXX de cualquier país (xnxx.es, xnxx.com, xnxx.xxx, etc)
  const isXNXX = host.includes("xnxx.");

  // TXNHH
  const isTXNHH = host === "txnhh.com" || host.endsWith(".txnhh.com");

  return isXNXX || isTXNHH;
}

function isSupportedUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/i.test(url.protocol)) return false;
    return isSupportedHost(url.hostname);
  } catch {
    return false;
  }
}

// Jobs pendientes por ID del mensaje preview
const pendingXNXX = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

async function getXnxxFromSky(url){
  const endpoint = `${API_BASE}/xnxx`;

  const { data: res, status: http } = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  let data = res;
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const r = data.result;
  const videoUrl = r?.media?.video;
  if (!videoUrl) throw new Error("No se encontró video descargable.");

  return {
    title: r.title || "Video",
    duration: r.duration || 0,
    video: videoUrl,
    cover: r.cover || null,
  };
}

async function sendVideo(conn, job, asDocument, triggerMsg) {
  const { chatId, url, caption, previewKey, quotedBase, fileBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await react(conn, chatId, previewKey, "⏳");

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: { url },
        mimetype: "video/mp4",
        fileName: asDocument ? `${fileBase}-${Date.now()}.mp4` : undefined,
        caption: asDocument ? caption : undefined,
      },
      { quoted: quotedBase || triggerMsg }
    );

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  }
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  let text = normalizeInputUrl(args.join(" "));

  if (!text) {
    return conn.sendMessage(
      chatId,
      { 
        text:
`✳️ Usa:
.xnxx <enlace> o .x <enlace>

✅ Acepta:
- XNXX (cualquier país): https://www.xnxx.es/video-xxxx/...
- TXNHH: https://www.txnhh.com/video-xxxx/...`
      },
      { quoted: msg }
    );
  }

  if (!isSupportedUrl(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa un link de XNXX (cualquier país) o TXNHH.` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getXnxxFromSky(text);

    const title   = d.title || "Video";
    const durTxt  = d.duration ? fmtSec(d.duration) : "—";

    const caption =
`⚡ 𝗫𝗡𝗫𝗫/𝗧𝗫𝗡𝗛𝗛 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀 ⚠️ +18

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durTxt}`;

    const preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });

    const fileBase = safeFileBase(title, "xnxx");

    pendingXNXX[preview.key.id] = {
      chatId,
      url: d.video,
      fileBase,
      caption:
`⚡ 𝗫𝗡𝗫𝗫/𝗧𝗫𝗡𝗛𝗛 — 𝘃𝗶𝗱𝗲𝗼 𝗹𝗶𝘀𝘁𝗼 ⚠️ +18

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durTxt}

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: ${API_BASE}
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await react(conn, chatId, msg.key, "✅");

    if (!conn._xnxxInteractiveListener) {
      conn._xnxxInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingXNXX)) {
              if (Date.now() - (pendingXNXX[k]?.createdAt || 0) > 15 * 60 * 1000) {
                delete pendingXNXX[k];
              }
            }

            // --- Reacciones (👍 / ❤️) al preview ---
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingXNXX[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.processing) continue;
              job.processing = true;

              const asDoc = emoji === "❤️";
              await sendVideo(conn, job, asDoc, m);

              delete pendingXNXX[reactKey.id];
              continue;
            }

            // --- Replies 1/2 citando el preview ---
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingXNXX[replyTo]) {
              const job = pendingXNXX[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body !== "1" && body !== "2") continue;
              if (job.processing) continue;
              job.processing = true;

              const asDoc = body === "2";
              await sendVideo(conn, job, asDoc, m);

              delete pendingXNXX[replyTo];
            }
          } catch (e) {
            console.error("XNXX listener error:", e?.message || e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error XNXX/TXNHH:", err?.message || err);

    let msgTxt = "❌ Ocurrió un error al procesar el video.";
    const s = String(err?.message || "");
    if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ Timeout o error del servidor.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

handler.command = ["xnxx", "xx"];
handler.help = ["xnxx <url>", "x <url>"];
handler.tags = ["descargas", "nsfw"];
handler.register = true;

export default handler;
