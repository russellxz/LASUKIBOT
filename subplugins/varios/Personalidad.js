const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  try {
    let userId = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.quotedMessage) {
      userId = ctx.participant;
    } else if (ctx?.mentionedJid?.length > 0) {
      userId = ctx.mentionedJid[0];
    } else if (msg.mentionedJid?.length > 0) {
      userId = msg.mentionedJid[0];
    }

    if (!userId) {
      return conn.sendMessage(chatId, {
        text: "⚠️ *Debes mencionar o responder a un usuario para analizar su personalidad.*"
      }, { quoted: msg });
    }

    await conn.sendMessage(chatId, {
      react: { text: "🎭", key: msg.key }
    });

    const personalidad = {
      "🌟 Carisma": rand(),
      "🧠 Inteligencia": rand(),
      "💪 Fortaleza": rand(),
      "😂 Humor": rand(),
      "🔥 Pasión": rand(),
      "🎨 Creatividad": rand(),
      "💼 Responsabilidad": rand(),
      "❤️ Empatía": rand(),
      "🧘 Paciencia": rand(),
      "🤖 Frialdad": rand(),
      "👑 Liderazgo": rand()
    };

    const userMention = `@${userId.split("@")[0]}`;
    let msgTexto = `🎭 *Análisis de Personalidad* 🎭\n\n👤 *Usuario:* ${userMention}\n\n`;

    for (const [atr, val] of Object.entries(personalidad)) {
      const barra = "▓".repeat(Math.floor(val / 10)) + "░".repeat(10 - Math.floor(val / 10));
      msgTexto += `*${atr}:* ${val}%\n${barra}\n\n`;
    }

    msgTexto += "📊 *Datos generados aleatoriamente. ¿Lo representa?* 🤔\n\n────────────\n🤖 _Suki Subbots_";

    let profilePic = "https://cdn.russellxz.click/7427a830.jpg";
    try {
      profilePic = await conn.profilePictureUrl(userId, "image");
    } catch {}

    await conn.sendMessage(chatId, {
      image: { url: profilePic },
      caption: msgTexto,
      mentions: [userId]
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en .personalidad:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al analizar la personalidad.*"
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
  }
};

function rand() {
  return Math.floor(Math.random() * 100) + 1;
}

handler.command = ["personalidad"];
export default handler;
