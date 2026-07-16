import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
import { exec as _cpExec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
const exec = promisify(_cpExec);

// Desencapsula view-once/ephemeral
const unwrap = (m) => {
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
};

const handler = async (msg, { conn, wa }) => {
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const inner = unwrap(ctx);
    const sticker = inner?.stickerMessage;

    if (!sticker) {
      return conn.sendMessage(
        msg.key.remoteJid,
        { text: "⚠️ *Debes responder a un sticker para convertirlo en imagen.*" },
        { quoted: msg }
      );
    }

    // ✅ Asegura downloadContentFromMessage aunque 'wa' no venga
    const dcfm =
      wa?.downloadContentFromMessage ||
      (await import("@whiskeysockets/baileys")).downloadContentFromMessage;

    await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

    const stream = await dcfm(sticker, "sticker");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    if (!buffer.length) throw new Error("Buffer vacío");

    // Dir temporal
    const tmpDir = path.join(__dirname, "../tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const base = Date.now();
    const stickerPath = path.join(tmpDir, `${base}.webp`);
    const imagePath = path.join(tmpDir, `${base}.png`);

    fs.writeFileSync(stickerPath, buffer);

    try {
      // Convierte WEBP -> PNG (requiere ffmpeg disponible en el contenedor)
      await exec(`ffmpeg -y -i "${stickerPath}" -vcodec png "${imagePath}"`);

      if (!fs.existsSync(imagePath)) throw new Error("La conversión falló");

      await conn.sendMessage(
        msg.key.remoteJid,
        { image: fs.readFileSync(imagePath), caption: "🖼️ *Imagen convertida del sticker*" },
        { quoted: msg }
      );

      await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });
    } catch (e) {
      console.error("Error en conversión:", e);
      throw new Error("Error al convertir el sticker");
    } finally {
      try {
        if (fs.existsSync(stickerPath)) fs.unlinkSync(stickerPath);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      } catch (cleanErr) {
        console.error("Error limpiando archivos:", cleanErr);
      }
    }
  } catch (error) {
    console.error("Error en toimg:", error);
    await conn.sendMessage(
      msg.key.remoteJid,
      { text: "❌ *Ocurrió un error al convertir el sticker. Asegúrate que es un sticker válido.*" },
      { quoted: msg }
    );
  }
};

handler.command = ["toimg", "stickerimg"];
handler.tags = ["tools"];
handler.help = [
  "toimg <responder a sticker> - Convierte sticker a imagen",
  "stickerimg <responder a sticker> - Convierte sticker a imagen",
];

export default handler;
