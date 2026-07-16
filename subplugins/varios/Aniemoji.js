import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Crypto from 'crypto';
import webp from 'node-webpmux';

const tempFolder = path.join(__dirname, "../tmp/");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

const handler = async (msg, { conn, args, text }) => {
  const emoji = text?.trim();

  const rawID = conn.user?.id || "";
  const subbotID = rawID.split(":")[0] + "@s.whatsapp.net";

  const prefixPath = path.resolve("prefixes.json");
  let prefixes = {};
  if (fs.existsSync(prefixPath)) {
    prefixes = JSON.parse(fs.readFileSync(prefixPath, "utf-8"));
  }
  const usedPrefix = prefixes[subbotID] || ".";

  if (!emoji || !emoji.match(/\p{Emoji}/u)) {
    return await conn.sendMessage(msg.key.remoteJid, {
      text: `❗ *Envía un emoji para animarlo como sticker.*\n\n📌 *Ejemplo:* \`${usedPrefix}aniemoji 😎\``
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(msg.key.remoteJid, {
      react: { text: "🕒", key: msg.key }
    });

    const { data } = await axios.get(`https://api.neoxr.eu/api/emojito?q=${encodeURIComponent(emoji)}&apikey=russellxz`);
    if (!data.status || !data.data?.url) {
      return await conn.sendMessage(msg.key.remoteJid, {
        text: "❌ *No se pudo generar el emoji animado. Intenta con otro.*"
      }, { quoted: msg });
    }

    const mediaRes = await axios.get(data.data.url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(mediaRes.data);

    const senderName = msg.pushName || "Usuario";
    const now = new Date();
    const fechaCreacion = `📅 ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} 🕒 ${now.getHours()}:${now.getMinutes()}`;

    const metadata = {
      packname: `✨ Emoji Animado: ${senderName}`,
      author: `🤖 Azura Ultra\n🛠️ Russell xz 💻\n${fechaCreacion}`,
      categories: [emoji]
    };

    const stickerBuffer = await writeExifDirect(buffer, metadata);

    await conn.sendMessage(msg.key.remoteJid, {
      sticker: { url: stickerBuffer }
    }, { quoted: msg });

    await conn.sendMessage(msg.key.remoteJid, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en aniemoji:", err);
    await conn.sendMessage(msg.key.remoteJid, {
      text: "❌ *Error procesando el emoji animado.*"
    }, { quoted: msg });

    await conn.sendMessage(msg.key.remoteJid, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ["aniemoji"];
export default handler;

/* === FUNCIONES DE EXIF DIRECTO === */

async function writeExifDirect(webpBuffer, metadata) {
  const tmpIn = path.join(tempFolder, randomFileName("webp"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "azura-aniemoji",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    "emojis": metadata.categories || [""]
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

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`;
}
