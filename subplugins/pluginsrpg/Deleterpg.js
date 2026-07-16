import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");
  const isFromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } });

  if (!global.isOwner(numero) && !isFromMe && numero !== botID) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los *owners* pueden usar este comando.",
      quoted: msg
    });
  }

  // Detectar el usuario a eliminar
  let target = null;

  if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
    target = msg.message.extendedTextMessage.contextInfo.participant.replace(/\D/g, "");
  } else if (args[0]?.match(/\d{5,}/)) {
    target = args[0].replace(/\D/g, "");
  } else if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
    target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0].replace(/\D/g, "");
  }

  if (!target) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso correcto:*\n.deleterpg 549xxxxxxxx\nO responde al mensaje del usuario o menciónalo con @`,
      quoted: msg
    });
  }

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(sukirpgPath)) {
    return conn.sendMessage(chatId, {
      text: "❌ La base de datos RPG aún no existe.",
      quoted: msg
    });
  }

  let db = JSON.parse(fs.readFileSync(sukirpgPath));
  db.usuarios = db.usuarios || [];
  db.personajes = db.personajes || [];

  const idx = db.usuarios.findIndex(u => u.numero === target);
  if (idx === -1) {
    return conn.sendMessage(chatId, {
      text: `❌ El usuario @${target} no está registrado en el RPG.`,
      mentions: [`${target}@s.whatsapp.net`],
      quoted: msg
    });
  }

  const user = db.usuarios[idx];

  if (user.personajes?.length) {
    for (const personaje of user.personajes) {
      db.personajes.push({
        nombre: personaje.nombre,
        imagen: personaje.imagen,
        precio: personaje.precio,
        nivel: personaje.nivel,
        habilidades: personaje.habilidades.map(h => ({ ...h }))
      });
    }
  }

  db.usuarios.splice(idx, 1);
  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  await conn.sendMessage(chatId, {
    text: `✅ El registro RPG del usuario @${target} ha sido eliminado correctamente.\n🛒 Sus personajes han sido devueltos a la tienda.`,
    mentions: [`${target}@s.whatsapp.net`],
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });
};

handler.command = ["deleterpg"];
export default handler;
