// comandos/fb.js — Facebook (URL) con Botones
// ✅ Mensaje de opciones: solo explicación de descarga
// ✅ Info del video: va con el archivo descargado
// ✅ Respeta activoss.json (botones on/off)

"use strict";

import { cabeceraDescarga, pieDescarga, getMarca, canal } from "../../disenos.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// === Config API ===
const API_BASE = "https://api-sky.ultraplus.click";
const API_KEY  = "Russellxz";
const MAX_MB = 200;

const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingFB = Object.create(null);
const mb = (n) => n / (1024 * 1024);

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

function isUrl(u = "") { return /^https?:\/\//i.test(String(u || "")); }
function isFB(u = "") { return /(facebook\.com|fb\.watch|fb\.com)/i.test(String(u || "")); }

function normalizeUrl(input = "") {
  let u = String(input || "").trim().replace(/^<|>$/g, "").trim();
  if (/^(www\.)?facebook\.com\//i.test(u) || /^fb\.watch\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }
  return u;
}

function safeFileName(name = "facebook") {
  const base = String(name || "facebook").slice(0, 70);
  return (base.replace(/[^A-Za-z0-9_\-.]+/g, "_") || "facebook");
}

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function pickBestVideoUrl(result) {
  const hd = String(result?.media?.video_hd || "").trim();
  const sd = String(result?.media?.video_sd || "").trim();
  if (hd && isUrl(hd)) return hd;
  if (sd && isUrl(sd)) return sd;
  return null;
}

async function getFacebookInfo(url) {
  const endpoint = `${API_BASE}/facebook`;
  const r = await axios.post(endpoint, { url }, {
    headers: { "Content-Type": "application/json", apikey: API_KEY },
    timeout: 60000,
    validateStatus: () => true,
  });
  const data = r.data;
  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || "Error en la API de Facebook");
  return data.result;
}

async function downloadVideoToTmp(srcUrl, filenameBase) {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const fname = `${safeFileName(filenameBase)}.mp4`;
  const dlUrl = `${API_BASE}/facebook/dl` +
    `?type=video` +
    `&src=${encodeURIComponent(srcUrl)}` +
    `&filename=${encodeURIComponent(fname)}` +
    `&download=1`;

  const res = await axios.get(dlUrl, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      apikey: API_KEY,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  const filePath = path.join(tmpDir, `fb-${Date.now()}.mp4`);
  const writer = fs.createWriteStream(filePath);
  res.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filePath));
    writer.on("error", reject);
  });
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `✳️ Usa:\n${pref}${command} <enlace>\nEj: ${pref}${command} https://fb.watch/xxxxxx/` },
      { quoted: msg }
    );
  }

  text = normalizeUrl(text);

  if (!isUrl(text) || !isFB(text)) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Enlace inválido. Solo Facebook.` }, { quoted: msg });
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const result = await getFacebookInfo(text);
    const videoUrl = pickBestVideoUrl(result);

    if (!videoUrl) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "🚫 No se encontró video (puede ser privado o reel protegido)." }, { quoted: msg });
    }

    const title = result?.title || "Facebook Video";
    const thumb = result?.thumbnail || result?.image || "";

    const usarBotones = botonesActivos() && !esIphone(msg);

    // 🎨 Caption LIMPIO — solo explicación + marca de agua
    const caption = usarBotones
      ? `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟢 *OPCIÓN  — Botones*
Toca un botón abajo del mensaje:
   🎬 *Video Normal*
   📁 *Video Documento*

${pieDescarga(conn)}`.trim()
      : `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Video normal
   ❤️  →  Video como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1*  →  Video normal
   *2*  →  Video como documento

${pieDescarga(conn)}`.trim();

    const nativeFlowButtons = [
      { text: "🎬 Video Normal",    id: `${pref}fb_video` },
      { text: "📁 Video Documento", id: `${pref}fb_videodoc` },
    ];

    let preview;
    if (usarBotones && thumb && isUrl(thumb)) {
      try {
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(),
          image: { url: thumb },
          caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons: nativeFlowButtons,
          headerType: 4,
        }, { quoted: msg });
      } catch (e) {
        console.log("[fb] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), image: { url: thumb }, caption }, { quoted: msg });
      }
    } else if (usarBotones) {
      try {
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(),
          text: caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons: nativeFlowButtons,
        }, { quoted: msg });
      } catch (e) {
        console.log("[fb] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), text: caption }, { quoted: msg });
      }
    } else {
      if (thumb && isUrl(thumb)) {
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), image: { url: thumb }, caption }, { quoted: msg });
      } else {
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), text: caption }, { quoted: msg });
      }
    }

    pendingFB[preview.key.id] = {
      chatId,
      url: videoUrl,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
      _createdAt: Date.now(),
    };

    setTimeout(() => {
      if (pendingFB[preview.key.id]) delete pendingFB[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._fbInteractiveListener) {
      conn._fbInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // A) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingFB[reactKey.id];
              if (!job || job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.isBusy) continue;

              const asDoc = emoji === "❤️";
              await sendVideo(conn, job, asDoc, m);
              continue;
            }

            // B) BOTONES
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
              const id = String(selectedId).trim();

              const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
              let job = null;
              if (ctxQuoted) {
              // La selección cita una tarjeta concreta: si no es NUESTRA, no es
              // para este bot. Sin esto, el bot principal y los subbots
              // descargaban lo mismo a la vez.
                job = pendingFB[ctxQuoted];
                if (!job) continue;
              } else {
                const jobs = Object.values(pendingFB)
                  .filter(j => j.chatId === m.key.remoteJid)
                  .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
                if (jobs.length > 0) job = jobs[0];
              }

              if (!job || job.isBusy) continue;

              if (id.endsWith("fb_video")) {
                await sendVideo(conn, job, false, m);
                continue;
              }
              if (id.endsWith("fb_videodoc")) {
                await sendVideo(conn, job, true, m);
                continue;
              }
            }

            // C) RESPUESTAS 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            if (ctx?.stanzaId && pendingFB[ctx.stanzaId]) {
              const job = pendingFB[ctx.stanzaId];
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;
              if (job.isBusy) continue;

              const asDoc = body === "2";
              await sendVideo(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("FB listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("Error FB:", err);
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error: ${err.message}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

async function sendVideo(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;
  const { chatId, url, title, quotedBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: "⏳ Espere, descargando su video..." }, { quoted: quotedBase });

    const filePath = await downloadVideoToTmp(url, title);
    const sizeMB = mb(fs.statSync(filePath).size);

    if (sizeMB > MAX_MB) {
      try { fs.unlinkSync(filePath); } catch {}
      return conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ El video pesa ${sizeMB.toFixed(2)} MB, excede el límite de ${MAX_MB} MB.` }, { quoted: quotedBase });
    }

    // 🎨 Caption final con TODA la info del video + marca de agua
    const finalCaption =
`╭━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗙𝗔𝗖𝗘𝗕𝗢𝗢𝗞 — 𝗩𝗜𝗗𝗘𝗢
╰━━━━━━━━━━━━━━━━━╯

📝 *Título:* ${title}
📦 *Formato:* ${asDocument ? "Documento" : "Video"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

━━━━━━━━━━━━━━━━━━
🤖 *Bot:* ${getMarca(conn)}
🔗 *API:* ${API_BASE}
━━━━━━━━━━━━━━━━━━`;

    const buf = fs.readFileSync(filePath);

    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        [asDocument ? "document" : "video"]: buf,
        mimetype: "video/mp4",
        fileName: `${safeFileName(title)}.mp4`,
        caption: finalCaption,
      },
      { quoted: quotedBase }
    );

    try { fs.unlinkSync(filePath); } catch {}
    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    console.error("Error enviando FB:", e);
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Falló el envío: ${e.message}` }, { quoted: quotedBase });
    await react(conn, chatId, triggerMsg.key, "❌");
  } finally {
    job.isBusy = false;
  }
}

handler.command = ["facebook", "fb"];
handler.help = ["facebook <url>", "fb <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
