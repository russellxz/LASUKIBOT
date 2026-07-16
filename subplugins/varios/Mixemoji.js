import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import Crypto from 'crypto';
import { tmpdir } from 'os';
import ffmpeg from 'fluent-ffmpeg';
import webp from 'node-webpmux';

const tempFolder = path.join(__dirname, "../tmp/");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

const handler = async (msg, { conn, args, text }) => {
  const chatId = msg.key.remoteJid;
  const senderName = msg.pushName || "Usuario Desconocido";

  if (!text.includes("+")) {
    return conn.sendMessage(chatId, {
      text: "❌ *Formato incorrecto.* Usa: .mixemoji 😳+😩",
    }, { quoted: msg });
  }

  const [emo1, emo2] = text.split("+").map(e => e.trim());
  if (!emo1 || !emo2) {
    return conn.sendMessage(chatId, {
      text: "⚠️ *Debes dar dos emojis para combinar.*\nEjemplo: .mixemoji 😳+😩",
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🔄", key: msg.key } });

    const url = `https://api.neoxr.eu/api/emoji?q=${encodeURIComponent(emo1 + "_" + emo2)}&apikey=russellxz`;
    const res = await fetch(url);
    const json = await res.json();

    if (!json.status || !json.data?.url) {
      return conn.sendMessage(chatId, {
        text: "❌ *No se pudo combinar esos emojis.*",
      }, { quoted: msg });
    }

    const response = await fetch(json.data.url);
    const imageBuffer = await response.buffer();

    const now = new Date();
    const fechaCreacion = `📅 ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} 🕒 ${now.getHours()}:${now.getMinutes()}`;

    const metadata = {
      packname: `✨ Emoji Mix by ${senderName} ✨`,
      author: `🤖 Azura Ultra Bot\n🛠️ Dev: 𝙍𝙪𝙨𝙨𝙚𝙡𝙡 xz 💻\n${fechaCreacion}`,
      categories: [emo1, emo2],
    };

    const stickerPath = await writeExifImg(imageBuffer, metadata);

    await conn.sendMessage(chatId, {
      sticker: { url: stickerPath },
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en mixemoji:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al procesar los emojis.*",
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["mixemoji"];
handler.tags = ["sticker"];
handler.help = ["mixemoji 😳+😩"];
export default handler;

/* === FUNCIONES DE STICKER CON EXIF Y CONVERSIÓN === */

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`;
}

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
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse"
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  fs.unlinkSync(tmpIn);
  fs.unlinkSync(tmpOut);
  return buff;
}

async function addExif(webpBuffer, metadata) {
  const tmpIn = path.join(tempFolder, randomFileName("webp"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "azura-ultra-mixemoji",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    "emojis": metadata.categories || [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00,
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

async function writeExifImg(media, metadata) {
  const wMedia = await imageToWebp(media);
  return await addExif(wMedia, metadata);
}
