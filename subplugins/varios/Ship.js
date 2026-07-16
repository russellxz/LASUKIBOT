const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  try {
    if (!chatId.endsWith("@g.us")) {
      return conn.sendMessage(chatId, {
        text: "❌ *Este comando solo funciona en grupos.*"
      }, { quoted: msg });
    }

    await conn.sendMessage(chatId, {
      react: { text: "💖", key: msg.key }
    });

    const metadata = await conn.groupMetadata(chatId);
    let participants = metadata.participants.map(p => p.id);
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid || [];

    let user1, user2;

    if (mentioned.length >= 2) {
      user1 = mentioned[0];
      user2 = mentioned[1];
    } else {
      if (participants.length < 2) {
        return conn.sendMessage(chatId, {
          text: "⚠️ *Se necesitan al menos 2 personas en el grupo para hacer un ship.*"
        }, { quoted: msg });
      }

      participants = participants.sort(() => Math.random() - 0.5);
      user1 = participants.pop();
      user2 = participants.pop();
    }

    const porcentaje = Math.floor(Math.random() * 101);
    let frase = "💔 *No parecen ser el uno para el otro...*";
    if (porcentaje >= 80) frase = "💞 *¡Una pareja perfecta, destinados a estar juntos!*";
    else if (porcentaje >= 50) frase = "💖 *Hay química, pero aún pueden mejorar.*";
    else if (porcentaje >= 20) frase = "💕 *Se llevan bien, pero no es un amor tan fuerte.*";

    const mensaje = `💘 *Ship del Amor* 💘\n\n` +
                    `❤️ *Pareja:* @${user1.split("@")[0]} 💕 @${user2.split("@")[0]}\n` +
                    `🔮 *Compatibilidad:* *${porcentaje}%*\n` +
                    `📜 ${frase}\n\n` +
                    `💍 *¿Deberían casarse?* 💌\n────────────\n👩‍❤️‍👨 _Suki Subbots_`;

    await conn.sendMessage(chatId, {
      text: mensaje,
      mentions: [user1, user2]
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (error) {
    console.error("❌ Error en .ship:", error);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al calcular el ship.*"
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
  }
};

handler.command = ["ship"];
export default handler;
