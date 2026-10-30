import axios from 'axios';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { subirCdn } from '../libs/cdn.js';

const handler = async (msg, { conn }) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const chat = msg.key.remoteJid;

  if (!quoted?.imageMessage) {
    return await conn.sendMessage(chat, {
      text: "❌ *Debes responder a una imagen para convertirla a estilo anime.*"
    }, { quoted: msg });
  }

  // Reacción
  await conn.sendMessage(chat, {
    react: { text: "✨", key: msg.key }
  });

  try {
    const stream = await downloadContentFromMessage(quoted.imageMessage, "image");

    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    // Subir al CDN de ORBITX SPACE
    const imageUrl = await subirCdn(buffer, { filename: "anime.jpg", contentType: "image/jpeg" });

    // Enviar a API de neoxr
    const api = `https://api.neoxr.eu/api/toanime?image=${encodeURIComponent(imageUrl)}&apikey=russellxz`;
    const animeRes = await axios.get(api);
    const resultUrl = animeRes.data?.data?.url;

    if (!resultUrl) {
      throw new Error("No se pudo generar la imagen anime.");
    }

    await conn.sendMessage(chat, {
      image: { url: resultUrl },
      caption: `🖼️ *Aquí tienes tu versión anime estilo waifu!*\n\n© Azura Ultra 2.0`
    }, { quoted: msg });

    await conn.sendMessage(chat, {
      react: { text: "✅", key: msg.key }
    });

  } catch (e) {
    console.error("❌ Error en toanime2:", e);
    await conn.sendMessage(chat, {
      text: "❌ *Ocurrió un error al convertir la imagen. Intenta con otra.*"
    }, { quoted: msg });

    await conn.sendMessage(chat, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ["toanime2"];
export default handler;
