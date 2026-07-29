// subplugins/varios/Xxxx.js — Analizador NSFW con SKY NSFW DETECTION
"use strict";

import { analizarBuffer } from '../../libs/nsfwsky.js';
import { muestrasDeMedia } from '../../libs/muestras.js';

const UMBRAL = 70;

// —— helpers ——
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}

function getQuotedMessage(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctxs = [
    root?.extendedTextMessage?.contextInfo,
    root?.imageMessage?.contextInfo,
    root?.videoMessage?.contextInfo,
    root?.audioMessage?.contextInfo,
    root?.documentMessage?.contextInfo,
    root?.stickerMessage?.contextInfo,
  ].filter(Boolean);
  for (const c of ctxs) if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  return null;
}

async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa.downloadContentFromMessage;
  const m = await import("@whiskeysockets/baileys");
  return m.downloadContentFromMessage;
}

async function downloadToBuffer(DL, type, content) {
  const stream = await DL(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

// Qué se ha citado y cómo hay que tratarlo.
function queEs(quoted) {
  if (quoted.videoMessage) {
    return {
      tipo: "video",
      nodo: quoted.videoMessage,
      extension: "mp4",
      animado: true,
      duracion: Number(quoted.videoMessage.seconds || 0),
      nombre: "media.mp4"
    };
  }

  if (quoted.stickerMessage) {
    const animado = !!quoted.stickerMessage.isAnimated;
    return {
      tipo: animado ? "sticker animado" : "sticker",
      nodo: quoted.stickerMessage,
      extension: "webp",
      animado,
      duracion: 0,
      nombre: "media.webp"
    };
  }

  if (quoted.imageMessage) {
    const mime = quoted.imageMessage.mimetype || "image/jpeg";
    let ext = String(mime).split("/")[1]?.split(";")[0] || "jpg";
    if (ext === "jpeg") ext = "jpg";

    return {
      tipo: "imagen",
      nodo: quoted.imageMessage,
      extension: ext,
      animado: false,
      duracion: 0,
      nombre: `media.${ext}`
    };
  }

  return null;
}

// —— handler ——
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;

  let DL;
  try { DL = await getDownloader(wa); }
  catch (e) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo cargar el downloader de Baileys." }, { quoted: msg });
    return;
  }

  try { await conn.sendMessage(chatId, { react: { text: "🔍", key: msg.key } }); } catch {}

  const quoted = getQuotedMessage(msg);
  if (!quoted) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *Responde a un video, imagen o sticker para analizar NSFW.*" },
      { quoted: msg }
    );
  }

  const media = queEs(quoted);
  if (!media) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *Tipo no soportado. Usa video, imagen o sticker.*" },
      { quoted: msg }
    );
  }

  try {
    const descarga = media.tipo === "video" ? "video" : media.tipo.startsWith("sticker") ? "sticker" : "image";
    const buffer = await downloadToBuffer(DL, descarga, media.nodo);

    // De un video o un sticker animado se sacan varias fotos repartidas a lo
    // largo de la duración; una imagen o un sticker quieto van tal cual.
    const muestras = await muestrasDeMedia(buffer, {
      animado: media.animado,
      duracion: media.duracion,
      extension: media.extension,
      nombreOriginal: media.nombre
    });

    const analisis = [];
    let fallo = null;

    for (const muestra of muestras) {
      const r = await analizarBuffer(muestra.datos, { nombre: muestra.nombre, umbral: UMBRAL });

      if (!r.ok) { fallo = r; continue; }

      analisis.push({ ...r, nota: muestra.nota });
    }

    if (!analisis.length) {
      throw new Error(fallo ? `${fallo.code || "ERROR"} — ${fallo.error || "Fallo desconocido."}` : "No se pudo analizar.");
    }

    // Vale el peor, igual que hace la API con los fotogramas de un video.
    const peor = analisis.reduce((a, b) => (b.percent > a.percent ? b : a));

    const estado = peor.esNsfw ? "🔞 *NSFW detectado*" : "✅ *Contenido seguro*";
    const barra = "█".repeat(Math.round(peor.percent / 10)).padEnd(10, "░");

    // Con varias muestras se enseña el desglose, para ver en qué momento salta.
    const desglose =
      analisis.length > 1
        ? "\n\n🎞️ *Momentos analizados:*\n" +
          analisis
            .map((a) => `   • ${a.nota}: ${a.porcentaje}%${a.esNsfw ? " 🔞" : ""}`)
            .join("\n")
        : "";

    const detalle = [
      `${estado}`,
      ``,
      `📊 *NSFW:* ${peor.porcentaje}%`,
      `${barra}`,
      `✅ *Seguro:* ${Number(peor.safe_percent ?? 0).toFixed(2)}%`,
      `📈 *Nivel:* ${peor.veredicto || peor.nivel || "—"}`,
      `🛠️ *Recomendación:* ${peor.accion || "—"}`,
      `📁 *Tipo:* ${media.tipo}${peor.formato ? ` (${peor.formato})` : ""}`,
      analisis.length === 1 && peor.nota ? `🎞️ *Analizado:* ${peor.nota}` : "",
      peor.fotogramas > 1 ? `🎬 *Fotogramas de la API:* ${peor.fotogramas}` : "",
      desglose,
      ``,
      `_SKY NSFW DETECTION_`
    ].filter(Boolean).join("\n");

    await conn.sendMessage(chatId, { text: detalle }, { quoted: msg });

    try { await conn.sendMessage(chatId, { react: { text: peor.esNsfw ? "🔞" : "✅", key: msg.key } }); } catch {}

  } catch (err) {
    console.error("[xxx] NSFW error:", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: `❌ *Error al analizar el archivo:* ${err?.message || "Fallo desconocido."}` },
      { quoted: msg }
    );
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  }
};

handler.command  = ["xxx"];
handler.tags     = ["tools"];
handler.help     = ["xxx <responde a un video, imagen o sticker>"];
handler.register = true;

export default handler;
