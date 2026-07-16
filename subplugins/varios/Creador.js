const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  const ownerNumber = "15167096032@s.whatsapp.net"; // Número del dueño en formato WhatsApp
  const ownerName = "Russell xz 🤖"; // Nombre que aparecerá en el contacto
  const messageText = `📞 *Contacto del Creador:*\n
Si tienes dudas, preguntas o sugerencias sobre el bot, puedes contactar a mi creador.

📌 *Nombre:* Russell
📌 *Número:* +1 (516) 709-6032
💬 *Mensaje directo:* Pulsa sobre el contacto y chatea con él.`;

  // 🧾 Enviar vCard del creador
  await conn.sendMessage(chatId, {
    contacts: {
      displayName: ownerName,
      contacts: [{
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${ownerName}\nTEL;waid=${ownerNumber.split('@')[0]}:+${ownerNumber.split('@')[0]}\nEND:VCARD`
      }]
    }
  });

  // 💬 Mensaje con texto explicativo
  await conn.sendMessage(chatId, { text: messageText }, { quoted: msg });
};

handler.command = ['creador', 'owner', 'contacto'];
export default handler;
