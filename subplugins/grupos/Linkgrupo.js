const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo funciona en grupos."
    }, { quoted: msg });
  }

  try {
    const code = await conn.groupInviteCode(chatId);
    const link = `https://chat.whatsapp.com/${code}`;

    await conn.sendMessage(chatId, {
      text: `🔗 *Link del grupo:*\n${link}`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "🔗", key: msg.key }
    });

  } catch (e) {
    console.error("❌ Error al obtener link del grupo:", e);
    await conn.sendMessage(chatId, {
      text: "⚠️ No se pudo obtener el enlace del grupo. Asegúrate que el bot sea admin."
    }, { quoted: msg });
  }
};

handler.command = ["linkgrupo"];
export default handler;
