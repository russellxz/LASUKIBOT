import { getMarca, canal } from "../../disenos.js";
import fetch from 'node-fetch';

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = args.join(" ");
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `⚠️ *Uso incorrecto.*\n📌 Ejemplo:\n${pref}${command} https://www.mediafire.com/file/ejemplo/file.zip`
    }, { quoted: msg });
  }

  if (!/^https?:\/\/(www\.)?mediafire\.com/.test(text)) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `⚠️ *Enlace no válido.*\n📌 Asegúrate de ingresar una URL de MediaFire válida.\n\nEjemplo:\n${pref}${command} https://www.mediafire.com/file/ejemplo/file.zip`
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, {
    react: { text: '⏳', key: msg.key }
  });

  try {
    const apiUrl = `https://api.neoxr.eu/api/mediafire?url=${encodeURIComponent(text)}&apikey=russellxz`;
    const response = await fetch(apiUrl);

    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    const data = await response.json();

    if (!data.status || !data.data?.url) throw new Error("No se pudo obtener el enlace de descarga.");

    const fileInfo = data.data;
    const fileResponse = await fetch(fileInfo.url);
    if (!fileResponse.ok) throw new Error("No se pudo descargar el archivo.");

    const fileBuffer = await fileResponse.buffer();

    const caption =
      `𖠁 *Nombre:* ${fileInfo.title}\n` +
      `𖠁 *Tamaño:* ${fileInfo.size}\n` +
      `𖠁 *Tipo:* ${fileInfo.mime}\n` +
      `𖠁 *Extensión:* ${fileInfo.extension}\n\n────────────\n𖠁 _${getMarca(conn)}_`;

    await conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: caption
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      document: fileBuffer,
      mimetype: fileInfo.mime,
      fileName: fileInfo.title
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: '✅', key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en .mediafire:", err);
    await conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `❌ *Error al procesar MediaFire:*\n_${err.message}_`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: '❌', key: msg.key }
    });
  }
};

handler.command = ["mediafire"];
export default handler;
