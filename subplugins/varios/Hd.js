import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/hd.js
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';

// Desencapsula viewOnce/ephemeral
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

// Obtiene el módulo de Baileys inyectado
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, command, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref   = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Usa:*\n${pref}${command}\n📌 Responde a una *imagen* para mejorarla.`
    }, { quoted: msg });
  }

  try { await conn.sendMessage(chatId, { react: { text: "🧪", key: msg.key } }); } catch {}

  const WA = ensureWA(wa, conn);
  if (!WA) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, { text: "❌ *Error interno:* downloader no disponible (inyecta `wa` en index.js)." }, { quoted: msg });
  }

  const tmpDir = path.join(__dirname, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  let tmpFile = null;
  try {
    // 1) Descargar imagen citada a un archivo temporal
    const imgNode = quoted.imageMessage;
    const stream = await WA.downloadContentFromMessage(imgNode, "image");
    const ext = (imgNode.mimetype?.split("/")[1] || "jpg").replace(/^x-/, "");
    tmpFile = path.join(tmpDir, `${Date.now()}_hd.${ext}`);
    const ws = fs.createWriteStream(tmpFile);
    for await (const chunk of stream) ws.write(chunk);
    await new Promise((r) => ws.end(r));

    // 2) Subir al CDN
    const form = new FormData();
    form.append("file", fs.createReadStream(tmpFile));
    const up = await axios.post("https://cdn.russellxz.click/upload.php", form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: s => s >= 200 && s < 500
    });

    const imageUrl =
      up?.data?.url ||
      up?.data?.data?.url ||
      up?.data?.result?.url ||
      null;

    if (!imageUrl) {
      throw new Error("No se obtuvo URL del CDN (upload).");
    }

    // 3) Llamar a Remini (neoxr)
    const API_KEY    = "russellxz"; // tu key
    const REMINI_URL = "https://api.neoxr.eu/api/remini";
    const rem = await axios.get(
      `${REMINI_URL}?image=${encodeURIComponent(imageUrl)}&apikey=${API_KEY}`,
      { timeout: 45000, validateStatus: s => s >= 200 && s < 500 }
    );

    const enhancedUrl =
      rem?.data?.data?.url ||
      rem?.data?.result?.url ||
      rem?.data?.url ||
      null;

    if (!rem?.data?.status || !enhancedUrl) {
      const reason = rem?.data?.message || "La API no devolvió una imagen mejorada.";
      throw new Error(reason);
    }

    // 4) Enviar imagen mejorada (por URL)
    await conn.sendMessage(chatId, {
      image: { url: enhancedUrl },
      caption: "✨ Imagen mejorada con éxito por *Suki Subbots*"
    }, { quoted: msg });

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}

  } catch (e) {
    console.error("❌ Error en .hd:", e);
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${e?.message || "Fallo desconocido."}`
    }, { quoted: msg });
  } finally {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
};

handler.command  = ["hd"];
handler.help     = ["hd"];
handler.tags     = ["tools"];
handler.register = true;
export default handler;
