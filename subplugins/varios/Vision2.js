import fetch from 'node-fetch';

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const query = args.join(" ");
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  if (!query) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Uso incorrecto.*\n📌 Ejemplo: \`${pref}${command} chica anime con ojos rojos y fondo futurista\``
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, {
    react: { text: "⏳", key: msg.key }
  });

  try {
    const apiUrl = `https://api.neoxr.eu/api/ai-anime?q=${encodeURIComponent(query)}&apikey=russellxz`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);

    const data = await response.json();
    if (!data.status || !data.data?.url) throw new Error("No se pudo generar la imagen.");

    const imageUrl = data.data.url;

    const caption =
      `🖼️ *Prompt usado:* ${data.data.prompt}\n` +
      `📎 *Imagen generada por IA anime*\n\n` +
      `🍧 API: api.neoxr.eu\n` +
      `© Suki Subbots`;

    await conn.sendMessage(chatId, {
      image: { url: imageUrl },
      caption,
      mimetype: 'image/png'
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en .vision2:", err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error al generar la imagen:*\n_${err.message}_`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ["vision2", "visión2"];
export default handler;
