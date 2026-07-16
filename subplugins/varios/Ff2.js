import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/ff2.js
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

  const audioMsg = q?.audioMessage || null;
  const docMsg   = q?.documentMessage || null;
  const isAudioDoc = !!(docMsg?.mimetype && docMsg.mimetype.startsWith('audio'));

  if (!audioMsg && !isAudioDoc) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso incorrecto.*\n📌 Responde a un *audio* o *mp3 dañado* con *${pref}ff2* para repararlo.`
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '🎧', key: msg.key } }).catch(() => {});

  // temp paths
  const tmpDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const base = Date.now();
  const inputPath  = path.join(tmpDir, `${base}_raw`);
  const outputPath = path.join(tmpDir, `${base}_fixed.mp3`);

  let sentReact = '🎧';
  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error('downloadContentFromMessage no disponible');

    // Selección de tipo de descarga correcta
    const node = audioMsg ? audioMsg : docMsg;
    const dlType = audioMsg ? 'audio' : 'document';

    const stream = await WA.downloadContentFromMessage(node, dlType);
    let buf = Buffer.alloc(0);
    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
    if (!buf.length) throw new Error('Descarga vacía');

    // Extensión de entrada por mimetype si existe
    let inExt = 'bin';
    const mt = node.mimetype || '';
    if (mt.includes('mpeg')) inExt = 'mp3';
    else if (mt.includes('ogg')) inExt = 'ogg';
    else if (mt.includes('opus')) inExt = 'ogg';
    else if (mt.includes('x-opus+ogg')) inExt = 'ogg';
    else if (mt.includes('wav')) inExt = 'wav';
    else if (mt.includes('aac')) inExt = 'aac';
    else if (mt.includes('m4a')) inExt = 'm4a';
    const inputFile = `${inputPath}.${inExt}`;

    fs.writeFileSync(inputFile, buf);

    const startTime = Date.now();

    // Reparar/normalizar a MP3 128k (WhatsApp-friendly)
    await new Promise((resolve, reject) => {
      ffmpeg(inputFile)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioFrequency(44100)
        .audioChannels(2)
        .format('mp3')
        .save(outputPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const endTime = ((Date.now() - startTime) / 1000).toFixed(1);

    await conn.sendMessage(chatId, {
      audio: fs.readFileSync(outputPath),
      mimetype: 'audio/mpeg',
      fileName: 'audio_reparado.mp3',
      // si era nota de voz, mantenemos ptt
      ptt: !!(audioMsg?.ptt)
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      text: `✅ *Audio reparado exitosamente*\n⏱️ *Tiempo de reparación:* ${endTime}s\n\n🎧 *Procesado por Suki Subbots*`
    }, { quoted: msg });

    sentReact = '✅';
  } catch (err) {
    console.error('❌ Error en .ff2:', err);
    await conn.sendMessage(chatId, {
      text: `❌ *Ocurrió un error al reparar el audio:*\n_${err?.message || err}_`
    }, { quoted: msg });
    sentReact = '❌';
  } finally {
    // cleanup
    try {
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(String(base)));
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
    } catch {}
    await conn.sendMessage(chatId, { react: { text: sentReact, key: msg.key } }).catch(() => {});
  }
};

handler.command = ['ff2'];
handler.help = ['ff2'];
handler.tags = ['herramientas'];
handler.register = true;

export default handler;
