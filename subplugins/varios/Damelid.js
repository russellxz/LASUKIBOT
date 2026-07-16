const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;

  await conn.sendMessage(chatId, {
    react: { text: '🛰️', key: msg.key }
  });

  const context = msg.message?.extendedTextMessage?.contextInfo;
  const citado = context?.participant;

  const objetivo = citado || senderId;
  const tipo = objetivo.endsWith('@lid') ? 'LIB oculto (@lid)' : 'Número visible (@s.whatsapp.net)';
  const numero = objetivo.replace(/[^0-9]/g, '');

  const mensaje = `
📡 *Identificador LID:*
👤 *Usuario:* ${objetivo}
🔢 *Número:* +${numero}
🔐 *Tipo:* ${tipo}
`;

  await conn.sendMessage(chatId, {
    text: mensaje.trim()
  }, { quoted: msg });
};

handler.command = ['damelid'];
export default handler;
