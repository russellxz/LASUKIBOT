import { canal } from '../../disenos.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { promisify } from 'util';
import { pipeline } from 'stream';
const streamPipe = promisify(pipeline);

// Generado por .crack a partir de https://screenapp.io/features/youtube-to-mp4-converter
// Revisa el endpoint y los campos antes de dejarlo en producción: si el
// sitio cambia su web, esto deja de funcionar y hay que volver a pasarle .crack.

'use strict';

const SITIO = "https://screenapp.io/features/youtube-to-mp4-converter";
const ENDPOINT = "https://screenapp.io/features/youtube-to-mp4-converter";
const METODO = "get";
const CAMPO_URL = "url";
const MAX_MB = 200;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const EXT_MEDIA = /\.(mp4|mkv|webm|m4v|mov|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|pdf|zip|apk)(\?|$)/i;

// Campos tal cual los mandaba la página. El del enlace se rellena al vuelo.
const CAMPOS = {};

function safeName(nombre = 'archivo') {
  return String(nombre).slice(0, 90).replace(/[^\w.\-]+/g, '_') || 'archivo';
}

function ensureTmp() {
  const tmp = path.resolve('./tmp');
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function extraerEnlaces(cuerpo) {
  const encontrados = [];

  try {
    const $ = cheerio.load(cuerpo);

    $('a[href], source[src], video[src], audio[src]').each((_, el) => {
      const v = $(el).attr('href') || $(el).attr('src') || '';
      const u = v ? new URL(v, SITIO).toString() : '';
      if (u && (EXT_MEDIA.test(u) || /(download|descarg|cdn)/i.test(u))) encontrados.push(u);
    });
  } catch {}

  return [...new Set(encontrados)];
}

async function pedirArchivo(enlace) {
  const cuerpo = { ...CAMPOS, [CAMPO_URL]: enlace };
  const datos = new URLSearchParams(cuerpo).toString();

  const res = await axios({
    method: METODO,
    url: METODO === 'get' ? ENDPOINT + '?' + new URLSearchParams(cuerpo).toString() : ENDPOINT,
    data: METODO === 'get' ? undefined : datos,
    timeout: 90000,
    maxRedirects: 5,
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: () => true,
    headers: {
      'User-Agent': UA,
      'Content-Type': "application/x-www-form-urlencoded",
      'X-Requested-With': 'XMLHttpRequest',
      Referer: SITIO,
      Origin: new URL(SITIO).origin,
      Accept: '*/*',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });

  if (res.status >= 400) throw new Error('El sitio respondió HTTP ' + res.status);

  const enlaces = extraerEnlaces(String(res.data || ''));
  if (!enlaces.length) throw new Error('El sitio no devolvió ningún enlace de descarga');

  return enlaces;
}

async function descargar(url, destino) {
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 300000,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: { 'User-Agent': UA, Referer: SITIO, Accept: '*/*' }
  });

  if (res.status >= 400) throw new Error('HTTP_' + res.status);

  const tipo = String(res.headers?.['content-type'] || '');
  if (/text\/html|application\/json/i.test(tipo)) {
    try { res.data.destroy(); } catch {}
    throw new Error('El enlace devolvió una página, no un archivo');
  }

  const esperado = Number(res.headers?.['content-length'] || 0);
  await streamPipe(res.data, fs.createWriteStream(destino));

  const real = fs.statSync(destino).size;
  if (!real) throw new Error('El archivo llegó vacío');
  if (esperado && real !== esperado) throw new Error('Descarga incompleta (' + real + ' de ' + esperado + ')');

  return destino;
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || '.';
  const enlace = (args[0] || '').trim();

  if (!enlace) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `✳️ Usa:\n${pref}${command} <enlace>\n\nDescarga desde ${SITIO}`
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

  let enlaces;

  try {
    enlaces = await pedirArchivo(enlace);
  } catch (e) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `❌ ${e.message}`
    }, { quoted: msg });
  }

  const tmp = ensureTmp();
  const destino = path.join(tmp, `${Date.now()}_${safeName(command)}`);

  let ultimoError;
  let listo = '';

  for (const url of enlaces.slice(0, 4)) {
    try {
      await descargar(url, destino);
      listo = url;
      break;
    } catch (e) {
      ultimoError = e;
      try { fs.unlinkSync(destino); } catch {}
    }
  }

  if (!listo) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `❌ No pude descargar el archivo: ${ultimoError?.message || 'sin enlaces válidos'}`
    }, { quoted: msg });
  }

  const sizeMB = fs.statSync(destino).size / (1024 * 1024);

  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(destino); } catch {}
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `❌ El archivo pesa ${sizeMB.toFixed(1)}MB y el límite son ${MAX_MB}MB.`
    }, { quoted: msg });
  }

  const esVideo = /\.(mp4|mkv|webm|m4v|mov)(\?|$)/i.test(listo);
  const esAudio = /\.(mp3|m4a|opus|ogg|wav|flac)(\?|$)/i.test(listo);
  const esImagen = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(listo);

  const extension = (listo.split('?')[0].split('.').pop() || 'bin').slice(0, 5);
  const nombre = `${safeName(command)}_${Date.now()}.${extension}`;

  const contenido = esVideo
    ? { video: { url: destino }, mimetype: 'video/mp4', fileName: nombre }
    : esAudio
      ? { audio: { url: destino }, mimetype: 'audio/mpeg', ptt: false, fileName: nombre }
      : esImagen
        ? { image: { url: destino } }
        : { document: { url: destino }, mimetype: 'application/octet-stream', fileName: nombre };

  await conn.sendMessage(chatId, { ...contenido, contextInfo: canal() }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

  try { fs.unlinkSync(destino); } catch {}
};

handler.command = ["yt444"];
handler.help = ["screenapp <enlace>"];
handler.tags = ['descargas'];

export default handler;
