import { getSenderPerms } from '../../libs/adminCheck.js';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo puede usarse en *grupos*."
    }, { quoted: msg });
  }

  const { isAdmin, isOwner, fromMe } = await getSenderPerms(conn, msg);

  if (!isOwner && !isAdmin && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ Solo el *dueño del bot* o un *administrador del grupo* puede usar este comando."
    }, { quoted: msg });
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, {
      text: "🛡️ *Usa:* `.antiarabe2 on` o `.antiarabe2 off`"
    }, { quoted: msg });
  }

  const nuevoEstado = estado === "on" ? 1 : 0;
  await conn.setSubConfig(chatId, "antiarabe2", nuevoEstado);

  await conn.sendMessage(chatId, {
    text: `🚫 El sistema *anti árabe 2* ha sido *${estado === "on" ? "activado" : "desactivado"}* en este grupo.`
  }, { quoted: msg });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🧕" : "🟢", key: msg.key }
  });
};

handler.command = ["antiarabe2"];
export default handler;
