import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/py.js — YT -> MP4 usando https://ytpy.ultraplus.click + ffmpeg
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = promisify(exec);

async function ytVideoDownload(url) {
  try {
    const response = await fetch('https://ytpy.ultraplus.click/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, option: 'video' })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    throw new Error(`Error al obtener el video: ${error.message}`);
  }
}

async function downloadVideoWithFfmpeg(m3u8Url, outputPath) {
  try {
    const command =
      `ffmpeg -protocol_whitelist file,http,https,tcp,tls -i "${m3u8Url}" ` +
      `-c copy -bsf:a aac_adtstoasc "${outputPath}" -y`;

    await execPromise(command, {
      maxBuffer: 1024 * 1024 * 100,
      timeout: 86400000
    });

    return outputPath;
  } catch (error) {
    throw new Error(`Error al descargar con ffmpeg: ${error.message}`);
  }
}

const react = (conn, msg, emoji) =>
  conn.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const handler = async (msg, { conn, args, usedPrefix, command }) => {
  const jid = msg.key.remoteJid;
  const prefix = usedPrefix || global.prefix || '.';

  if (!args[0]) {
    return conn.sendMessage(
      jid,
      { text: `*[⛅]* Envía el enlace del video de YouTube.\n*Ejemplo:* ${prefix + command} https://youtu.be/KHgllosZ3kA` },
      { quoted: msg }
    );
  }

  const videoUrl = args[0];

  if (!/youtu\.?be/i.test(videoUrl)) {
    return conn.sendMessage(
      jid,
      { text: '*[❌]* Por favor envía una URL válida de YouTube.' },
      { quoted: msg }
    );
  }

  const tempDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  try {
    await react(conn, msg, '🕓');
    await conn.sendMessage(jid, { text: '*[⏳]* Descargando video, espera un momento...' }, { quoted: msg });

    const result = await ytVideoDownload(videoUrl);

    if (!result || result.error || (result.status !== 'success' && result.success !== true)) {
      await react(conn, msg, '❌');
      return conn.sendMessage(
        jid,
        { text: `*[❌]* Error: ${result?.error || result?.message || 'No se pudo obtener el video'}` },
        { quoted: msg }
      );
    }

    const downloadUrl = result.url;
    const title = result.title || 'Video de YouTube';

    if (!downloadUrl) {
      await react(conn, msg, '❌');
      return conn.sendMessage(
        jid,
        { text: '*[❌]* No se pudo obtener el enlace de descarga.' },
        { quoted: msg }
      );
    }

    const ts = Date.now();
    const videoPath = path.join(tempDir, `video_${ts}.mp4`);

    const t0 = Date.now();
    await downloadVideoWithFfmpeg(downloadUrl, videoPath);
    const took = ((Date.now() - t0) / 1000).toFixed(2);

    if (!fs.existsSync(videoPath)) {
      await react(conn, msg, '❌');
      return conn.sendMessage(jid, { text: '*[❌]* Error al procesar el video.' }, { quoted: msg });
    }

    const size = fs.statSync(videoPath).size;
    const sizeMB = (size / (1024 * 1024)).toFixed(2);

    if (size > 100 * 1024 * 1024) {
      try { fs.unlinkSync(videoPath); } catch {}
      await react(conn, msg, '❌');
      return conn.sendMessage(
        jid,
        { text: `*[❌]* El video es demasiado grande (${sizeMB} MB).\n⚠️ WhatsApp tiene un límite de ~100 MB.` },
        { quoted: msg }
      );
    }

    await conn.sendMessage(
      jid,
      {
        video: fs.readFileSync(videoPath),
        mimetype: 'video/mp4',
        caption: `📹 *${title}*\n💾 Tamaño: ${sizeMB} MB\n⏱️ Descarga: ${took}s`
      },
      { quoted: msg }
    );

    try { fs.unlinkSync(videoPath); } catch {}
    await react(conn, msg, '✅');
  } catch (error) {
    console.error('Error en py:', error);
    await react(conn, msg, '❌');
    await conn.sendMessage(jid, { text: `*[❌]* Ocurrió un error: ${error.message}` }, { quoted: msg });
  }
};

handler.help = ['py <url>'];
handler.tags = ['downloader'];
handler.command = ['py'];

export default handler;
