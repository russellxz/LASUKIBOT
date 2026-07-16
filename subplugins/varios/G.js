import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, { react: { text: "📦", key: msg.key } });

  const paquete = args[0]?.toLowerCase();
  const index = parseInt(args[1]);

  if (!paquete || isNaN(index)) {
    return conn.sendMessage(chatId, {
      text: `❗ Usa correctamente:\n.g <paquete> <número>\nEj: .g memes 2`,
    }, { quoted: msg });
  }

  const guarPath = path.resolve("./guar.json");
  if (!fs.existsSync(guarPath)) {
    return conn.sendMessage(chatId, { text: "❌ No hay archivos guardados aún." }, { quoted: msg });
  }

  const db = JSON.parse(fs.readFileSync(guarPath));
  const archivo = db[paquete]?.[index - 1];

  if (!archivo) {
    return conn.sendMessage(chatId, {
      text: `❌ El paquete *${paquete}* no existe o el número *${index}* es inválido.`,
    }, { quoted: msg });
  }

  const buffer = Buffer.from(archivo.media, "base64");
  const extension = archivo.ext || archivo.mime?.split("/")[1] || "bin";
  const mime = archivo.mime || "";

  const opciones = { quoted: msg };
  let contenido = {};

  if (["jpg", "jpeg", "png"].includes(extension)) {
    contenido.image = buffer;
  } else if (["mp4", "mkv", "webm"].includes(extension)) {
    contenido.video = buffer;
  } else if (["mp3", "ogg", "opus"].includes(extension)) {
    contenido.audio = buffer;
    contenido.mimetype = mime || "audio/mpeg";
    contenido.ptt = false;
  } else if (["webp"].includes(extension)) {
    contenido.sticker = buffer;
  } else {
    contenido.document = buffer;
    contenido.mimetype = mime || "application/octet-stream";
    contenido.fileName = `archivo.${extension}`;
  }

  await conn.sendMessage(chatId, contenido, opciones);
};

handler.command = ["g"];
handler.help = ["g <paquete> <número>"];
handler.tags = ["utilidad"];

export default handler;
