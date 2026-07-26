// comandos/ig.js — Instagram VIDEO / IMAGEN / CARRUSEL con Neoxr API
// ✅ API: https://api.neoxr.eu/api/ig
// ✅ Botones directos usando formato Baileys real
// ✅ Si botones OFF: usa reacciones 👍 ❤️ o responde 1 / 2
// ✅ Descarga video, imagen o posts con varias imágenes/videos
// ✅ Respeta activoss.json

"use strict";

import { getMarca, canal } from "../../disenos.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

const NEOXR_BASE = "https://api.neoxr.eu/api";
const NEOXR_KEY = process.env.NEOXR_KEY || "russellxz";

const MAX_MB = Number(process.env.MAX_MB || 200);
const MAX_ITEMS = Number(process.env.IG_MAX_ITEMS || 10);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingIG = Object.create(null);

// Todos los subbots comparten este módulo (mismo proceso Node): cada trabajo
// se marca con el subbot que lo creó y solo ese subbot lo procesa.
const __owner = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const __mio = (conn, id) => {
  const j = pendingIG[id];
  return j && j.__own === __owner(conn) ? j : undefined;
};

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: a esos
// usuarios no se les mandan botones, se les da la versión de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));


function mb(n) {
  return n / (1024 * 1024);
}

function isIG(u = "") {
  return /(instagram\.com|instagr\.am)/i.test(String(u || ""));
}

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function normalizeIGUrl(input = "") {
  let u = String(input || "").trim();
  u = u.replace(/^<|>$/g, "").trim();

  if (/^(www\.)?instagram\.com\//i.test(u) || /^instagr\.am\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }

  return u;
}

function safeFileName(name = "instagram") {
  return (
    String(name || "instagram")
      .slice(0, 80)
      .replace(/[^A-Za-z0-9_\-. ]+/g, "_")
      .replace(/\s+/g, "_")
      .trim() || "instagram"
  );
}

function ensureTmp() {
  const tmp = path.resolve("./tmp");
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

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

function guessType(url = "", mime = "", keyName = "") {
  const u = String(url || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  const k = String(keyName || "").toLowerCase();

  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";

  if (k.includes("video")) return "video";
  if (k.includes("image") || k.includes("photo") || k.includes("display")) return "image";

  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) return "video";
  if (/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(u)) return "image";

  return "video";
}

function guessMime(type = "video", url = "", mime = "") {
  const u = String(url || "").toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (m.startsWith("video/") || m.startsWith("image/")) return m.split(";")[0];

  if (type === "image") {
    if (/\.png(\?|#|$)/i.test(u)) return "image/png";
    if (/\.webp(\?|#|$)/i.test(u)) return "image/webp";
    return "image/jpeg";
  }

  return "video/mp4";
}

function getExt(type = "video", mime = "", url = "") {
  const u = String(url || "").toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (type === "image") {
    if (m.includes("png") || /\.png(\?|#|$)/i.test(u)) return "png";
    if (m.includes("webp") || /\.webp(\?|#|$)/i.test(u)) return "webp";
    return "jpg";
  }

  return "mp4";
}

function shouldIgnoreUrl(url = "", keyName = "") {
  const u = String(url || "");
  const k = String(keyName || "").toLowerCase();

  if (!isUrl(u)) return true;

  if (/instagram\.com\/(p|reel|tv|stories)\//i.test(u)) return true;

  if (
    k.includes("profile") ||
    k.includes("avatar") ||
    k.includes("owner") ||
    k.includes("user_pic") ||
    k.includes("profile_pic")
  ) {
    return true;
  }

  return false;
}

function isThumbKey(keyName = "") {
  const k = String(keyName || "").toLowerCase();
  return k.includes("thumb") || k.includes("thumbnail") || k.includes("cover");
}

function pushMedia(out, url, type = "", mime = "", keyName = "") {
  if (shouldIgnoreUrl(url, keyName)) return;

  const mediaType = type || guessType(url, mime, keyName);
  const mediaMime = guessMime(mediaType, url, mime);

  out.push({
    url,
    type: mediaType,
    mime: mediaMime,
    isThumb: isThumbKey(keyName)
  });
}

function extractItems(apiData) {
  const found = [];

  function walk(value, keyName = "", depth = 0) {
    if (depth > 7 || value == null) return;

    if (typeof value === "string") {
      if (isUrl(value)) {
        pushMedia(found, value, "", "", keyName);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyName, depth + 1);
      return;
    }

    if (typeof value !== "object") return;

    const possibleUrl =
      value.url ||
      value.dl ||
      value.link ||
      value.download ||
      value.downloadUrl ||
      value.download_url ||
      value.media ||
      value.src ||
      value.video ||
      value.image ||
      value.display_url ||
      "";

    if (possibleUrl && typeof possibleUrl === "string") {
      let t = String(value.type || value.media_type || value.mime || value.mimetype || "").toLowerCase();

      if (t.includes("video") || t.includes("mp4")) t = "video";
      else if (t.includes("image") || t.includes("photo") || t.includes("jpg") || t.includes("png")) t = "image";
      else t = "";

      pushMedia(found, possibleUrl, t, value.mime || value.mimetype || "", keyName);
    }

    for (const [k, v] of Object.entries(value)) {
      walk(v, k, depth + 1);
    }
  }

  walk(apiData);

  const unique = [];
  const seen = new Set();

  for (const item of found) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }

  const noThumb = unique.filter(x => !x.isThumb);
  const usable = noThumb.length ? noThumb : unique;

  return usable.slice(0, MAX_ITEMS);
}

function getTitle(apiData) {
  const root = apiData?.result || apiData?.data || apiData;

  return (
    root?.title ||
    root?.caption ||
    root?.description ||
    root?.username ||
    "Instagram"
  );
}

function getThumbnail(apiData, items = []) {
  const root = apiData?.result || apiData?.data || apiData;

  const thumb =
    root?.thumbnail ||
    root?.thumb ||
    root?.cover ||
    root?.image ||
    root?.display_url ||
    "";

  if (thumb && isUrl(thumb)) return thumb;

  const firstImage = items.find(x => x.type === "image" && isUrl(x.url));
  if (firstImage) return firstImage.url;

  return "";
}

// ✅ API NEOXR
async function callNeoxrInstagram(url) {
  const endpoint = `${NEOXR_BASE}/ig`;

  const r = await axios.get(endpoint, {
    params: {
      url,
      apikey: NEOXR_KEY
    },
    timeout: 90000,
    headers: {
      Accept: "application/json, */*",
      "User-Agent": "Mozilla/5.0"
    },
    validateStatus: () => true
  });

  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  const ok =
    data?.status === true ||
    data?.status === "true" ||
    data?.ok === true ||
    data?.success === true ||
    data?.code === 200;

  if (!ok) {
    throw new Error(data?.message || data?.error || `HTTP ${r.status}`);
  }

  return data;
}

async function downloadToTmp(item, filenameBase = "instagram") {
  const tmp = ensureTmp();

  const res = await axios.get(item.url, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      Referer: "https://www.instagram.com/"
    },
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`);
  }

  const contentType = String(res.headers["content-type"] || item.mime || "").split(";")[0];

  let type = item.type || guessType(item.url, contentType);
  if (contentType.startsWith("image/")) type = "image";
  if (contentType.startsWith("video/")) type = "video";

  const mime = guessMime(type, item.url, contentType);
  const ext = getExt(type, mime, item.url);

  const filePath = path.join(
    tmp,
    `ig-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`
  );

  await streamPipe(res.data, fs.createWriteStream(filePath));

  return {
    filePath,
    type,
    mime,
    ext,
    fileName: `${safeFileName(filenameBase)}.${ext}`
  };
}

async function sendPreview(conn, chatId, msg, thumb, caption, usarBotones, pref) {
  if (!usarBotones) {
    return conn.sendMessage(
      chatId,
      thumb && isUrl(thumb)
        ? { image: { url: thumb }, caption }
        : { text: caption },
      { quoted: msg }
    );
  }

  // ✅ FORMATO REAL DE BOTONES PARA BAILEYS
  const buttons = [
    {
      buttonId: `${pref}ig_normal`,
      buttonText: { displayText: "🎬 Normal" },
      type: 1
    },
    {
      buttonId: `${pref}ig_doc`,
      buttonText: { displayText: "📄 Documento" },
      type: 1
    }
  ];

  const payload =
    thumb && isUrl(thumb)
      ? {
          image: { url: thumb },
          caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons,
          headerType: 4
        }
      : {
          text: caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons,
          headerType: 1
        };

  try {
    return await conn.sendMessage(chatId, payload, { quoted: msg });
  } catch (e) {
    console.log("[ig] botones formato Baileys fallaron, usando fallback:", e.message);

    // Fallback por si tu fork usa formato simple
    const simpleButtons = [
      { text: "🎬 Normal", id: `${pref}ig_normal` },
      { text: "📄 Documento", id: `${pref}ig_doc` }
    ];

    return conn.sendMessage(
      chatId,
      thumb && isUrl(thumb)
        ? {
            image: { url: thumb },
            caption,
            footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
            buttons: simpleButtons,
            headerType: 4
          }
        : {
            text: caption,
            footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
            buttons: simpleButtons,
            headerType: 1
          },
      { quoted: msg }
    );
  }
}

function getTextMessage(m) {
  return String(
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function findLatestJob(conn, chatId) {
  const jobs = Object.entries(pendingIG)
    .filter(([, j]) => j.chatId === chatId && j.__own === __owner(conn))
    .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));

  return jobs.length ? jobs[0][1] : null;
}

// 3. HANDLER PRINCIPAL
const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text:
`✳️ Usa:
${pref}${command} <enlace IG>

Ej:
${pref}${command} https://www.instagram.com/reel/XXXX/`
      },
      { quoted: msg }
    );
  }

  text = normalizeIGUrl(text);

  if (!isUrl(text) || !isIG(text)) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url de Instagram>` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const apiData = await callNeoxrInstagram(text);
    const items = extractItems(apiData);

    if (!items.length) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(
        chatId,
        {
      contextInfo: canal(), text: "🚫 No encontré imagen o video descargable en ese enlace." },
        { quoted: msg }
      );
    }

    const title = getTitle(apiData);
    const thumb = getThumbnail(apiData, items);
    const usarBotones = botonesActivos() && !esIphone(msg);

    const totalVideos = items.filter(x => x.type === "video").length;
    const totalImages = items.filter(x => x.type === "image").length;

    const resumen =
      totalVideos && totalImages
        ? `🎬 ${totalVideos} video(s) + 🖼️ ${totalImages} imagen(es)`
        : totalVideos
          ? `🎬 ${totalVideos} video(s)`
          : `🖼️ ${totalImages} imagen(es)`;

    const caption = usarBotones
      ? `
╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ⚡
╰━━━━━━━━━━━━━━━━╯

📦 *Contenido detectado:* ${resumen}

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟢 *OPCIÓN 1 — Botones*
Toca un botón abajo del mensaje:

🎬 *Normal*
📄 *Documento*

━━━━━━━━━━━━━━━━
🤖 *${getMarca(conn)}*
🔗 *API:* ${NEOXR_BASE}
━━━━━━━━━━━━━━━━
`.trim()
      : `
╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ⚡
╰━━━━━━━━━━━━━━━━╯

📦 *Contenido detectado:* ${resumen}

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟡 *OPCIÓN 1 — Reaccionar*
👍  →  Enviar normal
❤️  →  Enviar como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:

*1* → Normal
*2* → Documento

━━━━━━━━━━━━━━━━
🤖 *${getMarca(conn)}*
🔗 *API:* ${NEOXR_BASE}
━━━━━━━━━━━━━━━━
`.trim();

    const preview = await sendPreview(conn, chatId, msg, thumb, caption, usarBotones, pref);

    pendingIG[preview.key.id] = {
    __own: __owner(conn),
      chatId,
      items,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
      _createdAt: Date.now()
    };

    setTimeout(() => {
      delete pendingIG[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._igListener) {
      conn._igListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages || []) {
          try {
            const chatNow = m.key?.remoteJid;

            // ✅ REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = __mio(conn, reactKey.id);

              if (!job || job.chatId !== chatNow) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.isBusy) continue;

              const asDoc = emoji === "❤️";
              await processSend(conn, job, asDoc, m);
              continue;
            }

            // ✅ BOTONES
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

              if (!selectedId || !selectedId.includes("ig_")) continue;

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
                job = __mio(conn, ctxQuoted);
                if (!job) continue;
              } else {
                job = findLatestJob(conn, chatNow);
              }

              if (!job || job.isBusy) continue;

              if (selectedId.endsWith("ig_normal")) {
                await processSend(conn, job, false, m);
              }

              if (selectedId.endsWith("ig_doc")) {
                await processSend(conn, job, true, m);
              }

              continue;
            }

            // ✅ FALLBACK: si el botón llega como texto tipo ".ig_normal"
            const plainText = getTextMessage(m).toLowerCase();

            if (plainText.endsWith("ig_normal") || plainText.endsWith("ig_doc")) {
              const job = findLatestJob(conn, chatNow);
              if (!job || job.isBusy) continue;

              await processSend(conn, job, plainText.endsWith("ig_doc"), m);
              continue;
            }

            // ✅ RESPUESTAS CITADAS
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && __mio(conn, replyTo)) {
              const job = __mio(conn, replyTo);
              if (job.chatId !== chatNow) continue;
              if (job.isBusy) continue;

              const body = getTextMessage(m).toLowerCase();

              if (body !== "1" && body !== "2") continue;

              const asDoc = body === "2";
              await processSend(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("IG listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    const s = String(err?.message || "");
    console.error("❌ IG error:", s);
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error: ${s}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

async function processSend(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;

  const { chatId, items, quotedBase } = job;
  const title = job.title || "instagram";

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📄" : "🎬");

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text: asDocument
          ? "⏳ Espere, descargando como documento..."
          : "⏳ Espere, descargando su contenido..."
      },
      { quoted: quotedBase }
    );

    let sent = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      const fileData = await downloadToTmp(item, `${title}_${i + 1}`);
      const sizeMB = mb(fs.statSync(fileData.filePath).size);

      if (sizeMB > MAX_MB) {
        try { fs.unlinkSync(fileData.filePath); } catch {}

        await conn.sendMessage(
          chatId,
          {
      contextInfo: canal(),
            text: `❌ Archivo muy pesado (${sizeMB.toFixed(2)} MB). Límite ${MAX_MB} MB.`
          },
          { quoted: quotedBase }
        );

        continue;
      }

      const buf = fs.readFileSync(fileData.filePath);

      const finalCaption =
`✅ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 𝗗𝗘𝗦𝗖𝗔𝗥𝗚𝗔𝗗𝗢

📦 *Tipo:* ${fileData.type === "image" ? "Imagen" : "Video"}
📄 *Archivo:* ${i + 1}/${items.length}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

🤖 *Bot:* ${getMarca(conn)}
🔗 *API:* ${NEOXR_BASE}`;

      if (asDocument) {
        await conn.sendMessage(
          chatId,
          {
            document: buf,
            mimetype: fileData.mime,
            fileName: fileData.fileName,
            caption: finalCaption
          },
          { quoted: quotedBase }
        );
      } else {
        if (fileData.type === "image") {
          await conn.sendMessage(
            chatId,
            {
      contextInfo: canal(),
              image: buf,
              mimetype: fileData.mime,
              caption: finalCaption
            },
            { quoted: quotedBase }
          );
        } else {
          await conn.sendMessage(
            chatId,
            {
      contextInfo: canal(),
              video: buf,
              mimetype: fileData.mime,
              fileName: fileData.fileName,
              caption: finalCaption
            },
            { quoted: quotedBase }
          );
        }
      }

      sent++;

      try { fs.unlinkSync(fileData.filePath); } catch {}
    }

    if (!sent) {
      await conn.sendMessage(
        chatId,
        {
      contextInfo: canal(), text: "❌ No se pudo enviar ningún archivo." },
        { quoted: quotedBase }
      );
    } else {
      await react(conn, chatId, triggerMsg.key, "✅");
    }
  } catch (e) {
    await react(conn, chatId, triggerMsg.key, "❌");

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase }
    );
  } finally {
    job.isBusy = false;
  }
}

handler.command = ["instagram", "ig"];
handler.help = ["instagram <url>", "ig <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
