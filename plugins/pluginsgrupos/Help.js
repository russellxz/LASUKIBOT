import { mediaBuffer } from '../../libs/media.js';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  // Reacción al iniciar
  await conn.sendMessage(chatId, {
    react: { text: "🧠", key: msg.key }
  });

  const caption = `
*🌐INFORMACIÓN DEL BOT🌐*

💫 *Este es un bot privado en desarrollo.*
Actualmente está en *fase BETA* y *no está disponible al público*.  
Se están preparando dos versiones:

❖ *Versión Privada:*  
  ▸ Con sistema avanzado y estable de subbots.

❖ *Versión Pública:*  
  ▸ Más ligera y sin sistema de subbots.

📌 Puedes usar el comando ${pref}menu para descubrir mis funciones actuales y futuras.

🎬 Para estar al tanto de noticias, actualizaciones y lanzamientos:
🔗 *Sigue el canal de Sky Ultra Plus:*  
https://youtube.com/@skyultraplus?si=4hnO5biMvrUu9JXY

╰────────────────╯
`.trim();

  await conn.sendMessage(chatId, {
    image: mediaBuffer('info'),
    caption
  }, { quoted: msg });
};

handler.command = ['info', 'help'];
handler.tags = ['info'];
handler.help = ['info'];
handler.register = true;

export default handler;
