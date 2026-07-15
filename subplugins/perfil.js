const handler = async (msg, { conn, text, usedPrefix }) => {
  try {
    let userJid = null;

    await conn.sendMessage(msg.key.remoteJid, {
      react: { text: "📸", key: msg.key }
    });

    const hasMention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0;
    const hasParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const cleanText = (text || "").trim();

    if (!hasMention && !hasParticipant && !cleanText) {
      return await conn.sendMessage(msg.key.remoteJid, {
        text: `🔍 *¿Cómo usar el comando ${usedPrefix}perfil?*\n\n` +
              `📌 *Ejemplos de uso:*\n\n` +
              `🔹 *Para obtener la foto de perfil de alguien:* \n` +
              `   - *Responde a su mensaje con:* _${usedPrefix}perfil_\n\n` +
              `🔹 *Para obtener la foto de perfil de un número:* \n` +
              `   - _${usedPrefix}perfil +1 555-123-4567_\n\n` +
              `🔹 *Para obtener la foto de perfil de un usuario mencionado:* \n` +
              `   - _${usedPrefix}perfil @usuario_\n\n` +
              `⚠️ *Nota:* Algunos usuarios pueden tener su foto de perfil privada.`
      }, { quoted: msg });
    }

    if (hasMention) {
      userJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
    } else if (hasParticipant) {
      userJid = msg.message.extendedTextMessage.contextInfo.participant;
    } else if (cleanText) {
      let number = cleanText.replace(/\D/g, "");
      userJid = number + "@s.whatsapp.net";
    }

    if (!userJid) return;

    let ppUrl;
    try {
      ppUrl = await conn.profilePictureUrl(userJid, "image");
    } catch {
      ppUrl = "https://i.imgur.com/3J8M0wG.png";
    }

    await conn.sendMessage(msg.key.remoteJid, {
      image: { url: ppUrl },
      caption: `🖼️ *Foto de perfil de:* @${userJid.split("@")[0]}`,
      mentions: [userJid]
    }, { quoted: msg });

  } catch (error) {
    console.error("❌ Error en el comando perfil:", error);
    await conn.sendMessage(msg.key.remoteJid, {
      text: "❌ *Error:* No se pudo obtener la foto de perfil."
    }, { quoted: msg });
  }
};

handler.command = ['perfil'];
export default handler;
