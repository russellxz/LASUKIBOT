import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/ff.js
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// — helpers —
function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === 'function') return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === 'function') return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === 'function') return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  const quotedRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const q = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!q || !q.videoMessage) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso incorrecto.*\n📌 Responde a un *video* con *${pref}ff* para optimizarlo para WhatsApp.`
    }, { quoted: msg });
  }

  // reacción inicio
  await conn.sendMessage(chatId, { react: { text: '🔧', key: msg.key } }).catch(() => {});

  // rutas temporales
  const tmpDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const base = Date.now();
  const rawPath   = path.join(tmpDir, `${base}_raw.mp4`);
  const finalPath = path.join(tmpDir, `${base}_fixed.mp4`);

  let sentReact = '🔧';
  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error('downloadContentFromMessage no disponible');

    // descargar a buffer
    const stream = await WA.downloadContentFromMessage(q.videoMessage, 'video');
    let buf = Buffer.alloc(0);
    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
    if (!buf.length) throw new Error('Descarga vacía');

    // guardar archivo fuente
    fs.writeFileSync(rawPath, buf);

    const startTime = Date.now();

    // convertir con parámetros compatibles con WhatsApp
    await new Promise((resolve, reject) => {
      ffmpeg(rawPath)
        .outputOptions([
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30', // dimensiones pares + 30fps
          '-pix_fmt', 'yuv420p',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '28',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart'
        ])
        .save(finalPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const endTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // enviar video final
    await conn.sendMessage(chatId, {
      video: fs.readFileSync(finalPath),
      mimetype: 'video/mp4',
      fileName: 'video_optimo.mp4',
      caption: `✅ *Video optimizado correctamente para WhatsApp*\n⏱️ *Conversión realizada en:* ${endTime}s\n\n🎬 *Procesado por Suki Subbots*`
    }, { quoted: msg });

    sentReact = '✅';
  } catch (err) {
    console.error('❌ Error en .ff:', err);
    await conn.sendMessage(chatId, {
      text: `❌ *Ocurrió un error al procesar el video:*\n_${err?.message || err}_`
    }, { quoted: msg });
    sentReact = '❌';
  } finally {
    // limpiar
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    await conn.sendMessage(chatId, { react: { text: sentReact, key: msg.key } }).catch(() => {});
  }
};

handler.command = ['ff'];
handler.help = ['ff'];
handler.tags = ['herramientas'];
handler.register = true;

export default handler;
