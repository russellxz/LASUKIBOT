import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;

  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
  const isOwner = owners.some(([id]) => id === senderId);

  if (!isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo los dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
  }

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo funciona en grupos."
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "👋", key: msg.key } }).catch(() => {});

  try {
    await conn.sendMessage(chatId, {
      text: "👋 *Me voy de este grupo. ¡Hasta pronto!*"
    }, { quoted: msg });
    await conn.groupLeave(chatId);
  } catch (e) {
    console.error("[leave] error al salir:", e);
    await conn.sendMessage(chatId, {
      text: "❌ No pude salir del grupo."
    }, { quoted: msg });
  }
};

handler.command = ["leave"];
export default handler;
