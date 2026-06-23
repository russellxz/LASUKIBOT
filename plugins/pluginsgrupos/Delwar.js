import fs from 'fs';
import path from 'path';
import { getSenderPerms } from '../../libs/adminCheck.js';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo se puede usar en grupos."
    }, { quoted: msg });
  }

  const { isAdmin, isOwner, fromMe } = await getSenderPerms(conn, msg);

  if (!isAdmin && !isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores pueden usar este comando."
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "🧹", key: msg.key } });

  const advPath = path.resolve("./advertencias.json");

  if (!fs.existsSync(advPath)) {
    return conn.sendMessage(chatId, {
      text: "📁 No hay advertencias registradas aún."
    }, { quoted: msg });
  }

  const advertencias = JSON.parse(fs.readFileSync(advPath, "utf-8"));

  if (advertencias[chatId]) {
    delete advertencias[chatId];
    fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));
  }

  return conn.sendMessage(chatId, {
    text: "✅ Todas las advertencias del grupo han sido eliminadas."
  }, { quoted: msg });
};

handler.command = ["delwar"];
export default handler;
