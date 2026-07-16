import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/sticker.js
import fs from 'fs';
import path from 'path';
import Crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import webp from 'node-webpmux';

// === Carpeta temporal ===
const tempFolder = path.join(__dirname, "../tmp/");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

// === Helpers ===
const DIGITS = (s = "") => String(s).replace(/\D/g, "");

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

function ensureWA(wa, conn) {
  if (wa && wa.downloadContentFromMessage) return wa;
  if (conn && conn.wa && conn.wa.downloadContentFromMessage)
    return conn.wa;
  if (global.wa && global.wa.downloadContentFromMessage)
    return global.wa;
  return null;
}

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`;
}

// === Comando principal ===
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage && !quoted?.videoMessage) {
    return conn.sendMessage(
      chatId,
      {
        text: `⚠️ *Responde a una imagen o video para crear un sticker.*\n\n✳️ Ejemplo:\n${pref}s (respondiendo a una imagen)`,
      },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🛠️", key: msg.key } });

    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys (wa no inyectado).");

    const mediaType = quoted.imageMessage ? "image" : "video";
    const mediaNode = quoted[`${mediaType}Message`];
    const stream = await WA.downloadContentFromMessage(mediaNode, mediaType);
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const senderName = msg.pushName || "Usuario Desconocido";
    const fecha = new Date();
    const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()} ${fecha.getHours()}:${fecha.getMinutes()}`;

    const metadata = {
      packname: `✨ Lo Mandó Hacer: ${senderName}`,
      author: `🦋Bot Creador: ❦La Suki 3.0 Bot❦\n🛠️ Desarrollado por: Russell XZ 💻\n📅 ${fechaStr}`,
    };

    const outSticker =
      mediaType === "image"
        ? await writeExifImg(buffer, metadata)
        : await writeExifVid(buffer, metadata);

    await conn.sendMessage(
      chatId,
      { sticker: { url: outSticker } },
      { quoted: msg }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("[sticker] Error:", err);
    await conn.sendMessage(
      chatId,
      { text: "❌ *Hubo un error al crear el sticker.*" },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["s"];
export default handler;

// === Funciones auxiliares ===
async function imageToWebp(media) {
  const tmpIn = path.join(tempFolder, randomFileName("jpg"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf",
        "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse"
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  fs.unlinkSync(tmpIn);
  fs.unlinkSync(tmpOut);
  return buff;
}

async function videoToWebp(media) {
  const tmpIn = path.join(tempFolder, randomFileName("mp4"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf",
        "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
        "-loop", "0",
        "-ss", "00:00:00",
        "-t", "00:00:05",
        "-preset", "default",
        "-an",
        "-vsync", "0"
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  fs.unlinkSync(tmpIn);
  fs.unlinkSync(tmpOut);
  return buff;
}

async function writeExifImg(media, metadata) {
  const wMedia = await imageToWebp(media);
  return await addExif(wMedia, metadata);
}

async function writeExifVid(media, metadata) {
  const wMedia = await videoToWebp(media);
  return await addExif(wMedia, metadata);
}

async function addExif(webpBuffer, metadata) {
  const tmpIn = path.join(tempFolder, randomFileName("webp"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "suki-3.0",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    emojis: metadata.categories || [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00
  ]);

  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(tmpIn);
  img.exif = exif;
  await img.save(tmpOut);
  fs.unlinkSync(tmpIn);
  return tmpOut;
}
