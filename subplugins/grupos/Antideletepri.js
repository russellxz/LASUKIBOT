// subplugins/grupos/Antideletepri.js — Antidelete en PRIVADO para el SUBBOT.
// El subbot puede activarlo desde su propio número en cualquier conversación
// privada, pero SOLO el mismo subbot puede usar este comando.
// Config independiente por subbot: subbots/data/<numero>/activos.json
const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderNum = String(msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;
  const botNumber = String(conn.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
  const isBot = isFromMe || senderNum === botNumber;
  const p = conn?.subPrefixes?.[0] || ".";

  if (!isBot) {
    await conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede usar este comando."
    }, { quoted: msg });
    return;
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    await conn.sendMessage(chatId, {
      text: `🎛️ *Usa:* \`${p}antideletepri on\` o \`${p}antideletepri off\``
    }, { quoted: msg });
    return;
  }

  const nuevoEstado = estado === "on" ? 1 : 0;
  conn.setSubConfig("global", "antideletepri", nuevoEstado);

  await conn.sendMessage(chatId, {
    text: `✅ *Antidelete privado* del subbot ha sido ${estado === "on" ? "*activado*" : "*desactivado*"} en todos los chats privados.`
  }, { quoted: msg });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🛡️" : "❌", key: msg.key }
  }).catch(() => {});
};

handler.command = ["antideletepri"];
export default handler;
