import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
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

  const link = args[0];
  if (!link) {
    return conn.sendMessage(chatId, {
      text: "🔗 *Debes enviar el link del grupo.*\n\nEjemplo: *.join https://chat.whatsapp.com/XXXXXXXXXXXXXXXXXXXX*"
    }, { quoted: msg });
  }

  const match = link.match(/chat\.whatsapp\.com\/([0-9A-Za-z]+)/);
  if (!match) {
    return conn.sendMessage(chatId, {
      text: "❌ *Ese no es un link de grupo de WhatsApp válido.*"
    }, { quoted: msg });
  }

  const code = match[1];

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }).catch(() => {});

  try {
    const result = await conn.groupAcceptInvite(code);
    const groupId = typeof result === "string" ? result : result?.gid || result?.id;

    let groupName = groupId;
    try {
      const meta = await conn.groupMetadata(groupId);
      groupName = meta?.subject || groupId;
    } catch {}

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `✅ *Me uní al grupo correctamente.*\n📌 Grupo: *${groupName}*`
    }, { quoted: msg });
  } catch (e) {
    console.error("[join] error al unirse:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: "❌ No pude unirme al grupo. El link puede estar vencido, ser inválido, o ya estoy dentro del grupo."
    }, { quoted: msg });
  }
};

handler.command = ["join"];
export default handler;
