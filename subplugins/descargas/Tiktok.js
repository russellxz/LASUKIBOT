// comandos/tt.js — TikTok con Botones
// ✅ Mensaje de opciones: solo explicación de descarga
// ✅ Info del video: va con el archivo descargado
// ✅ Respeta activoss.json (botones on/off)

"use strict";

import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

const ACTIVOSS_FILE = path.resolve("./activoss.json");

const fmtSec = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
};

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

const pendingTT = Object.create(null);

async function getTikTokFromSky(url){
  const { data: res, status: http } = await axios.post(
    `${API_BASE}/tiktok`,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: s => s >= 200 && s < 600
    }
  );

  if (http !== 200) {
    throw new Error(`HTTP ${http}${res?.message ? ` - ${res.message}` : ""}`);
  }

  if (!res || res.status !== true || !res.result?.media?.video) {
    throw new Error(res?.message || "La API no devolvió un video válido.");
  }

  const r = res.result;
  return {
    title: r.title || "TikTok",
    author: r.author || {},
    duration: r.duration || 0,
    likes: r.stats?.likes ?? 0,
    comments: r.stats?.comments ?? 0,
    video: r.media.video,
    audio: r.media.audio || null,
    cover: r.media.cover || null,
  };
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text   = (args || []).join(" ");
  const pref   = ((typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes) && (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)[0]) || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace>
Ej: ${pref}${command} https://vm.tiktok.com/xxxxxx/`
    }, { quoted: msg });
  }

  const url = args[0];
  if (!/^https?:\/\//i.test(url) || !/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ 𝙀𝙣𝙡𝙖𝙘𝙚 𝙙𝙚 𝙏𝙞𝙠𝙏𝙤𝙠 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙤." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    const d = await getTikTokFromSky(url);

    const title   = d.title || "TikTok";
    const author  = (d.author && (d.author.name || d.author.username)) || "—";
    const durTxt  = d.duration ? fmtSec(d.duration) : "—";
    const likes   = d.likes ?? 0;
    const comments= d.comments ?? 0;

    const usarBotones = botonesActivos();

    // 🎨 Caption LIMPIO — solo explicación + marca de agua
    const caption = usarBotones
      ? `
╭━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗧𝗜𝗞𝗧𝗢𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥
╰━━━━━━━━━━━━━━━━━╯
━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━
🟢 *OPCIÓN — Botones*
Toca un botón abajo del mensaje:
   🎬 *Video Normal*
   📁 *Video Documento*
━━━━━━━━━━━━━━━
🤖 *Suki Subbots*
━━━━━━━━━━━━━━━`.trim()
      : `
╭━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗧𝗜𝗞𝗧𝗢𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥
╰━━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Video normal
   ❤️  →  Video como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1*  →  Video normal
   *2*  →  Video como documento

━━━━━━━━━━━━━━━━
🤖 *Suki Subbots*
━━━━━━━━━━━━━━━━`.trim();

    const nativeFlowButtons = [
      { text: "🎬 Video Normal",    id: `${pref}tt_video` },
      { text: "📁 Video Documento", id: `${pref}tt_videodoc` },
    ];

    let preview;
    if (usarBotones && d.cover) {
      try {
        preview = await conn.sendMessage(chatId, {
          image: { url: d.cover },
          caption,
          footer: "❦ Suki Subbots — Selecciona una opción ❦",
          buttons: nativeFlowButtons,
          headerType: 4,
        }, { quoted: msg });
      } catch (e) {
        console.log("[tt] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, { image: { url: d.cover }, caption }, { quoted: msg });
      }
    } else if (usarBotones) {
      try {
        preview = await conn.sendMessage(chatId, {
          text: caption,
          footer: "❦ Suki Subbots — Selecciona una opción ❦",
          buttons: nativeFlowButtons,
        }, { quoted: msg });
      } catch (e) {
        console.log("[tt] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
      }
    } else {
      if (d.cover) {
        preview = await conn.sendMessage(chatId, { image: { url: d.cover }, caption }, { quoted: msg });
      } else {
        preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
      }
    }

    // Guardar trabajo con TODA la info para el caption final
    pendingTT[preview.key.id] = {
      chatId,
      url: d.video,
      title,
      author,
      durTxt,
      likes,
      comments,
      quotedBase: msg,
      isBusy: false,
      _createdAt: Date.now(),
    };

    setTimeout(() => {
      if (pendingTT[preview.key.id]) delete pendingTT[preview.key.id];
    }, 10 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._ttListener) {
      conn._ttListener = true;

      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          try {
            // A) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTT[reactKey.id];

              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.isBusy) continue;

              const asDoc = emoji === "❤️";
              await processSend(conn, job, asDoc, m);
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
              if (ctxQuoted && pendingTT[ctxQuoted]) {
                job = pendingTT[ctxQuoted];
              } else {
                const jobs = Object.values(pendingTT)
                  .filter(j => j.chatId === m.key.remoteJid)
                  .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
                if (jobs.length > 0) job = jobs[0];
              }

              if (!job || job.isBusy) continue;

              if (id.endsWith("tt_video")) {
                await processSend(conn, job, false, m);
                continue;
              }
              if (id.endsWith("tt_videodoc")) {
                await processSend(conn, job, true, m);
                continue;
              }
            }

            // C) RESPUESTAS 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && pendingTT[replyTo]) {
              const job = pendingTT[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              const textLow = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
              if (textLow !== "1" && textLow !== "2") continue;
              if (job.isBusy) continue;

              const asDoc = textLow === "2";
              await processSend(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("TT listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error en tt:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "Fallo al procesar el TikTok."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

async function processSend(conn, job, asDocument, triggerMsg){
  job.isBusy = true;
  const { chatId, url, title, author, durTxt, likes, comments, quotedBase } = job;

  try {
    await conn.sendMessage(chatId, { react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `⏳ Espere, descargando video${asDocument ? " en documento" : ""}...`
    }, { quoted: quotedBase });

    // 🎨 Caption final con TODA la info del video + marca de agua
    const finalCaption =
`╭━━━━━━━━━━━━━━━╮
   ⚡ 𝗧𝗜𝗞𝗧𝗢𝗞 — 𝗩𝗜𝗗𝗘𝗢
╰━━━━━━━━━━━━━━━━╯

📝 *Título:* ${title}
👤 *Autor:* ${author}
⏱️ *Duración:* ${durTxt}
📊 *Estadísticas:* 👍 ${likes} · 💬 ${comments}
📦 *Formato:* ${asDocument ? "Documento" : "Video"}

━━━━━━━━━━━━━━━━━━
🤖 *Bot:* Suki Subbots
🔗 *API:* ${API_BASE}
━━━━━━━━━━━━━━━━━━`;

    if (asDocument) {
      await conn.sendMessage(chatId, {
        document: { url },
        mimetype: "video/mp4",
        fileName: `tiktok-${Date.now()}.mp4`,
        caption: finalCaption
      }, { quoted: quotedBase });
    } else {
      await conn.sendMessage(chatId, {
        video: { url },
        mimetype: "video/mp4",
        caption: finalCaption
      }, { quoted: quotedBase });
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });

  } catch (e) {
    console.error("TT send error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
  } finally {
    job.isBusy = false;
  }
}

handler.command = ["tiktok","tt"];
handler.help = ["tiktok <url>", "tt <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
