import axios from 'axios';

const handler = async (msg, { conn, text, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  if (!args.length) {
    return await conn.sendMessage(chatId, {
      text: `✳️ *Usa:*\n${pref}${command} <prompt>\n📌 Ej: *${pref}${command}* una chica guerrera en el espacio estilo anime`
    }, { quoted: msg });
  }

  const prompt = args.join(' ');
  const apiUrl = `https://api.hiuraa.my.id/ai-img/imagen?text=${encodeURIComponent(prompt)}`;

  await conn.sendMessage(chatId, {
    react: { text: '🧠', key: msg.key }
  });

  try {
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    if (!response.data) throw new Error('No se pudo generar la imagen.');

    const imageBuffer = Buffer.from(response.data, 'binary');

    await conn.sendMessage(chatId, {
      image: imageBuffer,
      caption: `🎨 *Prompt:* ${prompt}\n\n🖼️ Imagen generada con DALL·E`,
      mimetype: 'image/jpeg'
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en el comando dalle:", err.message);
    await conn.sendMessage(chatId, {
      text: `❌ *Ocurrió un error al generar la imagen:*\n_${err.message}_`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ['dalle'];
handler.help = ['dalle <prompt>'];
handler.tags = ['ia'];
handler.register = true;

export default handler;
