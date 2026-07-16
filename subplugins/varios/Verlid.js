const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');

  if (!isGroup) {
    return await conn.sendMessage(chatId, {
      text: '❌ Este comando solo puede usarse en grupos.'
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, {
      react: { text: '🔍', key: msg.key }
    });

    const metadata = await conn.groupMetadata(chatId);
    const participantes = metadata.participants || [];

    const conLib = [];
    const sinLib = [];

    for (const p of participantes) {
      const jid = p.id || '';
      if (jid.endsWith('@s.whatsapp.net')) {
        const numero = jid.split('@')[0];
        conLib.push(`• ${jid}  +${numero}`);
      } else if (jid.endsWith('@lid')) {
        sinLib.push(`• ${jid}`);
      }
    }

    const mensaje = `
📄 *Estado de LID en el grupo:*
👥 *Total miembros:* ${participantes.length}

✅ *Sin LID (número visible):* ${conLib.length}
${conLib.length ? conLib.join('\n') : '• Ninguno'}

❌ *Con LID (numeros ocultos por - lid para mayor seguridad segun whatsapp):* ${sinLib.length}
${sinLib.length ? sinLib.join('\n') : '• Ninguno'}

ℹ️ WhatsApp está ocultando números reales con el formato *@lid* para proteger la privacidad.
`;

    await conn.sendMessage(chatId, {
      text: mensaje.trim()
    }, { quoted: msg });

  } catch (err) {
    console.error("❌ Error en verlib:", err);
    await conn.sendMessage(chatId, {
      text: '❌ Ocurrió un error al obtener la información del grupo.'
    }, { quoted: msg });
  }
};

handler.command = ['verlid'];
export default handler;
