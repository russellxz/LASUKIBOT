// plugins/porn.js — Pornhub Downloader (via tu API /phfans)
// ✅ Default calidad: 240
// ✅ Calidad opcional: 240 / 480 / 720 / 1080
// ✅ Cambiar calidad respondiendo: 240/480/720/1080
// ✅ Reacciones: 👍 (Video) / ❤️ (Documento) o Respuestas 1 / 2
// ✅ DESCARGA REAL (direct url) y ENVÍA el MP4 por WhatsApp
"use strict";

import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_BASE = "https://api-sky.ultraplus.click";
const API_KEY = "Russellxz";
const ENDPOINT = "/phfans";

const MAX_MB = 200;
const pendingPORN = Object.create(null);

// Todos los subbots comparten este módulo (mismo proceso Node): cada trabajo
// se marca con el subbot que lo creó y solo ese subbot lo procesa.
const __owner = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const __mio = (conn, id) => {
  const j = pendingPORN[id];
  return j && j.__own === __owner(conn) ? j : undefined;
};

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: a esos
// usuarios no se les mandan botones, se les da la versión de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function isPornhub(u = "") {
  u = String(u || "");
  return /pornhub\./i.test(u) && /view_video\.php\?viewkey=/i.test(u);
}

function normalizeUrl(input = "") {
  let u = String(input || "").trim().replace(/^<|>$/g, "").trim();
  if (/^(www\.)?pornhub\./i.test(u)) u = "https://" + u;
  return u;
}

function safeFileName(name = "phfans") {
  const base = String(name || "phfans").slice(0, 70);
  return base.replace(/[^A-Za-z0-9_\-.]+/g, "_") || "phfans";
}

function pickText(msg) {
  const m = msg?.message || {};
  return String(
    m?.conversation ||
      m?.extendedTextMessage?.text ||
      m?.imageMessage?.caption ||
      m?.videoMessage?.caption ||
      ""
  ).trim();
}

function extractUrl(text = "") {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const u = parts.find((p) => isUrl(p)) || parts[0] || "";
  return normalizeUrl(u);
}

function parseQualityAny(q) {
  const n = Number(String(q || "").replace(/[^\d]/g, ""));
  if ([240, 480, 720, 1080].includes(n)) return n;
  return null;
}

function pickQualityFromText(text = "") {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const n = parseQualityAny(p);
    if (n) return n;
  }
  return 240;
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

async function getPhfansInfo(url) {
  const endpoint = API_BASE.replace(/\/+$/, "") + ENDPOINT;
  const r = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
      },
      timeout: 60000,
      validateStatus: () => true,
    }
  );

  const data = r.data;
  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || "Error en la API /phfans");
  return data.result;
}

// ✅ Selector robusto (sirve con "720" o "720p")
function selectVideoFromList(videos, wantQ = 240) {
  const arr = Array.isArray(videos) ? videos : [];
  if (!arr.length) return null;

  const want = Number(wantQ) || 240;

  // normaliza calidad -> número
  const norm = arr
    .map((v) => {
      const q = Number(String(v?.quality || "").replace(/[^\d]/g, "")) || 0;
      return { v, q };
    })
    .filter((x) => x.v && (x.v.url || x.v.proxy || x.v.proxy_inline));

  if (!norm.length) return null;

  // match exacto por número
  let pick = norm.find((x) => x.q === want)?.v || null;

  // si no hay exacto, el más cercano hacia abajo; si no, el más bajo
  if (!pick) {
    const sorted = norm.slice().sort((a, b) => a.q - b.q); // asc
    const below = sorted.filter((x) => x.q && x.q <= want);
    pick = (below[below.length - 1]?.v) || sorted[0]?.v || null;
  }

  if (!pick) return null;

  return {
    quality: String(Number(String(pick.quality || "").replace(/[^\d]/g, "")) || want),
    direct: String(pick.url || "").trim(), // <-- DIRECTO (sin /dl = sin 401)
    proxy: String(pick.proxy || pick.proxy_inline || "").trim(),
    raw: pick,
  };
}

async function downloadToTmpDirect(srcUrl, title, quality) {
  if (!srcUrl || !isUrl(srcUrl)) throw new Error("URL directa inválida");

  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const base = safeFileName(title || "phfans");
  const q = String(quality || "240");
  const outName = `${base}_${q}p.mp4`;
  const filePath = path.join(tmpDir, `ph-${Date.now()}-${q}.mp4`);

  const ctrl = new AbortController();
  let downloaded = 0;
  const maxBytes = MAX_MB * 1024 * 1024;

  const res = await axios.get(srcUrl, {
    responseType: "stream",
    timeout: 180000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    signal: ctrl.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
      Referer: "https://pornhubfans.com/",
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`No se pudo descargar directo (HTTP ${res.status})`);
  }

  const ct = String(res.headers?.["content-type"] || "");
  if (ct.includes("application/json") || ct.includes("text/html")) {
    let txt = "";
    await new Promise((resolve) => {
      res.data.on("data", (c) => (txt += c.toString()));
      res.data.on("end", resolve);
      res.data.on("error", resolve);
    });
    throw new Error("Upstream no devolvió MP4: " + txt.slice(0, 180));
  }

  const writer = fs.createWriteStream(filePath);

  res.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > maxBytes) {
      try { ctrl.abort(); } catch {}
      try { writer.destroy(); } catch {}
      try { fs.unlinkSync(filePath); } catch {}
    }
  });

  res.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    res.data.on("error", reject);
  });

  if (!fs.existsSync(filePath)) {
    throw new Error(`El video excede ${MAX_MB}MB o falló la descarga.`);
  }

  return { filePath, fileName: outName };
}

async function sendPorn(conn, job, asDocument, triggerMsg) {
  if (job.isBusy) return;
  job.isBusy = true;

  const { chatId, quotedBase, title, videos } = job;

  // 🔥 recalcula la elección SIEMPRE según wantQ actual
  const chosen = selectVideoFromList(videos, job.wantQ || 240);
  const q = String(chosen?.quality || job.wantQ || "240");

  try {
    if (!chosen?.direct) throw new Error("No hay URL directa para esa calidad.");

    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su video..." }, { quoted: quotedBase });

    const { filePath, fileName } = await downloadToTmpDirect(chosen.direct, title, q);

    const caption =
      `✅ *PORNHUB DOWNLOADER*\n\n` +
      `📝 *Título:* ${title}\n` +
      `🎞️ *Calidad:* ${q}p\n\n` +
      `🔗 API: ${API_BASE}`;

    await conn.sendMessage(
      chatId,
      asDocument
        ? { document: { url: filePath }, mimetype: "video/mp4", fileName, caption }
        : { video: { url: filePath }, mimetype: "video/mp4", fileName, caption },
      { quoted: quotedBase }
    );

    try { fs.unlinkSync(filePath); } catch {}
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    const fallback =
      `❌ No pude enviar el MP4.\n` +
      `Motivo: ${e?.message || e}\n\n` +
      `Calidad pedida: ${q}p`;

    await conn.sendMessage(chatId, { text: fallback }, { quoted: quotedBase });
    await react(conn, chatId, triggerMsg.key, "❌");
  } finally {
    job.isBusy = false;
  }
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  try { await react(conn, chatId, msg.key, "⏳"); } catch {}

  const text = args?.length ? args.join(" ") : pickText(msg);
  const url = extractUrl(text);
  const wantQ = pickQualityFromText(text);

  if (!url || !isPornhub(url)) {
    await conn.sendMessage(
      chatId,
      {
        text:
          `✳️ *Uso:*\n` +
          `${pref}${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=XXXX\n` +
          `Opcional calidad: 240 / 480 / 720 / 1080 (default 240)\n\n` +
          `Ej:\n` +
          `${pref}${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=68aaa9a034cca 720`,
      },
      { quoted: msg }
    );
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  let result;
  try {
    result = await getPhfansInfo(url);
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error consultando API:\n${e.message || e}` }, { quoted: msg });
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  const title = String(result?.title || "Pornhub Video").slice(0, 120);
  const thumb =
    String(result?.thumbnail?.proxy_inline || result?.thumbnail?.proxy || result?.thumbnail?.url || result?.thumbnail || "").trim();

  const videos = Array.isArray(result?.videos) ? result.videos : [];
  const chosenNow = selectVideoFromList(videos, wantQ);

  if (!chosenNow?.direct) {
    await conn.sendMessage(chatId, { text: "❌ No encontré link directo de video en la respuesta de la API." }, { quoted: msg });
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  const caption =
    `✅ *PORNHUB DOWNLOADER*\n\n` +
    `📝 *Título:* ${title}\n` +
    `🎞️ *Calidad actual:* ${(jobQ(wantQ))}p\n\n` +
    `📌 Cambiar calidad: responde *240 / 480 / 720 / 1080*\n\n` +
    `Elige cómo enviarlo:\n` +
    `👍 Video (normal)\n` +
    `❤️ Video como documento\n` +
    `— o responde: 1 = normal · 2 = documento`;

  function jobQ(q){ return Number(q)||240; }

  let preview;
  try {
    if (thumb && isUrl(thumb)) preview = await conn.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg });
    else preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
  } catch {
    preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
  }

  pendingPORN[preview.key.id] = {
    __own: __owner(conn),
    chatId,
    quotedBase: msg,
    title,
    thumb,
    videos,      // ✅ guardamos lista completa
    wantQ,       // ✅ guardamos calidad seleccionada
    isBusy: false,
  };

  setTimeout(() => {
    if (pendingPORN[preview.key.id]) delete pendingPORN[preview.key.id];
  }, 10 * 60 * 1000);

  try { await react(conn, chatId, msg.key, "✅"); } catch {}

  if (!conn._pornInteractiveListener) {
    conn._pornInteractiveListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages || []) {
        try {
          // Reacciones (👍/❤️) al preview
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = __mio(conn, reactKey.id);
            if (!job || job.chatId !== m.key.remoteJid) continue;
            if (emoji !== "👍" && emoji !== "❤️") continue;
            await sendPorn(conn, job, emoji === "❤️", m);
            continue;
          }

          // Respuestas al preview
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          if (ctx?.stanzaId && __mio(conn, ctx.stanzaId)) {
            const job = __mio(conn, ctx.stanzaId);
            if (!job || job.chatId !== m.key.remoteJid) continue;

            const body = String(
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              ""
            ).trim();

            // ✅ si responde una calidad: actualizar y avisar
            const q = parseQualityAny(body);
            if (q) {
              job.wantQ = q;
              const exists = selectVideoFromList(job.videos, q);
              if (!exists?.direct) {
                await conn.sendMessage(job.chatId, { text: `⚠️ Esa calidad (${q}p) no está disponible.`, quoted: job.quotedBase });
              } else {
                await conn.sendMessage(job.chatId, { text: `✅ Calidad cambiada a ${q}p.\nAhora reacciona 👍/❤️ o responde 1/2 para enviarlo.`, quoted: job.quotedBase });
              }
              continue;
            }

            // 1/2 para enviar
            if (body === "1" || body === "2") {
              await sendPorn(conn, job, body === "2", m);
              continue;
            }
          }
        } catch (e) {
          console.error("PORN listener error:", e);
        }
      }
    });
  }
};

handler.command = ["porn"];
handler.help = ["porn <url> [240|480|720|1080]"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
