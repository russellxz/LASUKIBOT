import fetch from 'node-fetch';

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = args.join(" ");
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  const participant = msg.key.participant || msg.key.remoteJid;
  const userMention = `@${participant.replace(/[^0-9]/g, "")}`;

  try {
    await conn.sendMessage(chatId, {
      react: { text: "🎨", key: msg.key }
    });

    if (!text) {
      return conn.sendMessage(chatId, {
        text: `⚠️ *Uso incorrecto del comando.*\n✳️ *Ejemplo:* \`${pref}${command} chica anime estilo ghibli\`\n🔹 *Describe lo que deseas generar.*`
      }, { quoted: msg });
    }

    await conn.sendMessage(chatId, {
      react: { text: "🔄", key: msg.key }
    });

    const prompt = text;
    const apiUrl = `https://api.dorratz.com/v2/pix-ai?prompt=${encodeURIComponent(prompt)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { images } = await res.json();
    if (!images?.length) {
      return conn.sendMessage(chatId, {
        text: "❌ *No se encontraron resultados.* Intenta con otra descripción."
      }, { quoted: msg });
    }

    for (const imageUrl of images.slice(0, 4)) {
      await conn.sendMessage(chatId, {
        image: { url: imageUrl },
        caption: `🖼️ *Imagen generada para:* ${userMention}\n📌 *Prompt:* ${prompt}\n\n🍧 *API:* api.dorratz.com\n────────────\n🤖 _Suki Subbots_`,
        mentions: [participant]
      }, { quoted: msg });
    }

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en .pixai:", err);
    await conn.sendMessage(chatId, {
      text: `❌ *Fallo al generar la imagen:*\n_${err.message}_`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ["pixai"];
export default handler;
