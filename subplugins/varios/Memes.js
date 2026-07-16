import hispamemes from 'hispamemes';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  try {
    const meme = hispamemes.meme();

    await conn.sendMessage(chatId, {
      react: { text: "😆", key: msg.key }
    });

    await conn.sendMessage(chatId, {
      image: { url: meme },
      caption: "🤣 *¡Aquí tienes un meme del día!*\n\n────────────\n🤖 _Suki Subbots_"
    }, { quoted: msg });

  } catch (e) {
    console.error("❌ Error en el comando meme:", e);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al obtener el meme. Intenta de nuevo más tarde.*"
    }, { quoted: msg });
  }
};

handler.command = ["meme", "memes"];
export default handler;
