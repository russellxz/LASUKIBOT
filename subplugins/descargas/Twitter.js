// commands/twitter.js — X/Twitter con Botones
// ✅ Mensaje de opciones: solo explicación de descarga
// ✅ Info del post: va con el archivo descargado
// ✅ Respeta activoss.json (botones on/off)

"use strict";

import { cabeceraDescarga, pieDescarga, getMarca, canal } from "../../disenos.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingTW = Object.create(null);

// Todos los subbots comparten este módulo (mismo proceso Node): cada trabajo
// se marca con el subbot que lo creó y solo ese subbot lo procesa.
const __owner = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const __mio = (conn, id) => {
  const j = pendingTW[id];
  return j && j.__own === __owner(conn) ? j : undefined;
};

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: a esos
// usuarios no se les mandan botones, se les da la versión de reacciones/números.
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

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function isValidX(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u)
      || /^https?:\/\/(www\.)?x\.com\/i\/status\/\d+/i.test(u);
}

async function getTwitterFromSky(url) {
  const endpoint = `${API_BASE}/twitter`;

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
    try { data = JSON.parse(data.trim()); } catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const r = data.result || {};
  const best = r?.media?.best || r?.media?.items?.[0];
  if (!best) throw new Error("No se encontró media.");

  const direct = best?.url || best?.direct || best?.link || best?.media_url || null;
  const proxyInline = best?.proxy?.inline || null;
  const proxyDownload = best?.proxy?.download || proxyInline;

  if (!direct && !proxyInline) throw new Error("No se encontró enlace descargable.");

  const type = best.type === "video" ? "video" : "image";

  return {
    type,
    direct,
    proxyInline,
    proxyDownload,
    author: r.author || {},
    stats: r.stats || {},
    date: r.date || "",
    text: r.text || "",
    sourceUrl: r.url || url,
  };
}

async function fetchBuffer(url, useAuthHeaders) {
  const headers = useAuthHeaders
    ? { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
    : {};

  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: MAX_TIMEOUT,
    headers,
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  const ct = String(r.headers["content-type"] || "");
  return { buffer: Buffer.from(r.data), contentType: ct };
}

async function sendMedia(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;
  const { chatId, type, direct, proxyInline, proxyDownload, quotedBase } = job;
  const { authorName, username, likes, replies, retweets, date } = job;

  const isVideo = type === "video";
  const mimetype = isVideo ? "video/mp4" : "image/jpeg";
  const ext = isVideo ? "mp4" : "jpg";
  const tipo = isVideo ? "Video" : "Imagen";

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: "⏳ Espere, descargando su archivo..." }, { quoted: quotedBase });

    // 🎨 Caption final con TODA la info + marca de agua
    const finalCaption =
`╭━━━━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗫 / 𝗧𝗪𝗜𝗧𝗧𝗘𝗥 — ${tipo.toUpperCase()}
╰━━━━━━━━━━━━━━━━━━━━╯

👤 *Autor:* ${authorName} ${username}
📊 *Estadísticas:* ❤️ ${likes} · 💬 ${replies} · 🔁 ${retweets}
${date ? `📅 *Fecha:* ${date}\n` : ""}📦 *Formato:* ${asDocument ? "Documento" : "Normal"}

━━━━━━━━━━━━━━━━━━━━
🤖 *Bot:* ${getMarca(conn)}
🔗 *API:* ${API_BASE}
━━━━━━━━━━━━━━━━━━━━`;

    // A) Intento: URL directa
    const urlTry = direct || proxyInline;
    if (urlTry) {
      try {
        if (asDocument) {
          await conn.sendMessage(
            chatId,
            {
      contextInfo: canal(), document: { url: urlTry }, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption: finalCaption },
            { quoted: quotedBase || triggerMsg }
          );
        } else {
          if (isVideo) {
            await conn.sendMessage(chatId, {
      contextInfo: canal(), video: { url: urlTry }, mimetype: "video/mp4", caption: finalCaption }, { quoted: quotedBase || triggerMsg });
          } else {
            await conn.sendMessage(chatId, {
      contextInfo: canal(), image: { url: urlTry }, caption: finalCaption }, { quoted: quotedBase || triggerMsg });
          }
        }
        await react(conn, chatId, triggerMsg.key, "✅");
        return;
      } catch (e) {
        // URL falló, intentamos buffer
      }
    }

    // B) Fallback: buffer
    let bufRes = null;
    if (direct) {
      try { bufRes = await fetchBuffer(direct, false); } catch {}
    }
    if (!bufRes && proxyDownload) {
      bufRes = await fetchBuffer(proxyDownload, true);
    }

    if (!bufRes) throw new Error("No se pudo descargar el archivo.");

    const mediaBuffer = bufRes.buffer;

    if (asDocument) {
      await conn.sendMessage(
        chatId,
        {
      contextInfo: canal(), document: mediaBuffer, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption: finalCaption },
        { quoted: quotedBase || triggerMsg }
      );
    } else {
      if (isVideo) {
        await conn.sendMessage(chatId, {
      contextInfo: canal(), video: mediaBuffer, mimetype: "video/mp4", caption: finalCaption }, { quoted: quotedBase || triggerMsg });
      } else {
        await conn.sendMessage(chatId, {
      contextInfo: canal(), image: mediaBuffer, caption: finalCaption }, { quoted: quotedBase || triggerMsg });
      }
    }

    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    console.error("TW Send Error:", e);
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  } finally {
    job.isBusy = false;
  }
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  const text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `✳️ Usa:\n${pref}tw <enlace>\nEj: ${pref}tw https://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  if (!isValidX(text)) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Enlace inválido.\nUsa un link tipo:\nhttps://x.com/usuario/status/123` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getTwitterFromSky(text);

    const authorName = d.author?.name || "X";
    const username = d.author?.username ? `@${String(d.author.username).replace(/^@/, "")}` : "";
    const likes = Number(d.stats?.likes || 0);
    const replies = Number(d.stats?.replies || 0);
    const retweets = Number(d.stats?.retweets || 0);

    const usarBotones = botonesActivos() && !esIphone(msg);

    // 🎨 Caption LIMPIO — solo explicación + marca de agua
    const caption = usarBotones
      ? `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟢 *OPCIÓN  — Botones*
Toca un botón abajo del mensaje:
   🎬 *Normal*
   📁 *Documento*

${pieDescarga(conn)}`.trim()
      : `
${cabeceraDescarga(conn, "📥 CÓMO DESCARGAR")}

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Enviar normal
   ❤️  →  Enviar como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1*  →  Enviar normal
   *2*  →  Enviar como documento

${pieDescarga(conn)}`.trim();

    const nativeFlowButtons = [
      { text: "🎬 Normal",    id: `${pref}tw_normal` },
      { text: "📁 Documento", id: `${pref}tw_documento` },
    ];

    let preview;
    if (usarBotones) {
      try {
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(),
          text: caption,
          footer: `❦ ${getMarca(conn)} — Selecciona una opción ❦`,
          buttons: nativeFlowButtons,
        }, { quoted: msg });
      } catch (e) {
        console.log("[tw] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), text: caption }, { quoted: msg });
      }
    } else {
      preview = await conn.sendMessage(chatId, {
      contextInfo: canal(), text: caption }, { quoted: msg });
    }

    // Guardar TODA la info en el job para el caption final
    pendingTW[preview.key.id] = {
    __own: __owner(conn),
      chatId,
      type: d.type,
      direct: d.direct,
      proxyInline: d.proxyInline,
      proxyDownload: d.proxyDownload,
      authorName,
      username,
      likes,
      replies,
      retweets,
      date: d.date,
      quotedBase: msg,
      previewKey: preview.key,
      _createdAt: Date.now(),
      isBusy: false,
    };

    setTimeout(() => {
      if (pendingTW[preview.key.id]) delete pendingTW[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._twInteractiveListener) {
      conn._twInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // A) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = __mio(conn, reactKey.id);

              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.isBusy) continue;

              await sendMedia(conn, job, emoji === "❤️", m);
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
              if (ctxQuoted && __mio(conn, ctxQuoted)) {
                job = __mio(conn, ctxQuoted);
              } else {
                const jobs = Object.values(pendingTW)
                  .filter(j => j.chatId === m.key.remoteJid && j.__own === __owner(conn))
                  .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
                if (jobs.length > 0) job = jobs[0];
              }

              if (!job || job.isBusy) continue;

              if (id.endsWith("tw_normal")) {
                await sendMedia(conn, job, false, m);
                continue;
              }
              if (id.endsWith("tw_documento")) {
                await sendMedia(conn, job, true, m);
                continue;
              }
            }

            // C) RESPUESTAS 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            if (replyTo && __mio(conn, replyTo)) {
              const job = __mio(conn, replyTo);
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;
              if (job.isBusy) continue;

              await sendMedia(conn, job, body === "2", m);
            }
          } catch (e) {
            console.error("Twitter listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error Twitter:", err?.message || err);
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error: ${err?.message || "unknown"}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

handler.command = ["twitter", "tw", "xdl", "x"];
handler.help = ["tw <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
