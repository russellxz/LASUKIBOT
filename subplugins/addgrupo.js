// subplugins/addgrupo.js — Agrega/quita el grupo actual a la lista donde el
// subbot responde a TODOS los usuarios. Guardado en subbots/data/<numero>/grupos.json
// 🚫 Solo lo puede usar el mismo subbot (fromMe)
const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const fromMe = msg.key.fromMe;
  const p = conn?.subPrefixes?.[0] || ".";

  if (!fromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede usar este comando."
    }, { quoted: msg });
  }

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: `❌ Este comando solo se usa *dentro de un grupo*.\nEntra al grupo y escribe *${p}${command}* ahí.`
    }, { quoted: msg });
  }

  let grupos = conn.readSubData("grupos.json", []);
  if (!Array.isArray(grupos)) grupos = [];

  let nombre = "este grupo";
  try {
    const meta = await conn.groupMetadata(chatId);
    if (meta?.subject) nombre = `*${meta.subject}*`;
  } catch {}

  if (command === "addgrupo") {
    if (grupos.includes(chatId)) {
      return conn.sendMessage(chatId, {
        text: `ℹ️ ${nombre} ya está en la lista. El subbot ya responde a todos aquí.`
      }, { quoted: msg });
    }

    grupos.push(chatId);
    conn.writeSubData("grupos.json", grupos);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `✅ ${nombre} fue agregado a la lista.\n🤖 Ahora el subbot responderá a *todos los usuarios* de este grupo.\n\n✖️ Para quitarlo: *${p}delgrupo*`
    }, { quoted: msg });
  }

  // delgrupo
  if (!grupos.includes(chatId)) {
    return conn.sendMessage(chatId, {
      text: `ℹ️ ${nombre} no está en la lista.`
    }, { quoted: msg });
  }

  grupos = grupos.filter(g => g !== chatId);
  conn.writeSubData("grupos.json", grupos);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  return conn.sendMessage(chatId, {
    text: `✅ ${nombre} fue quitado de la lista.\n🤖 El subbot ya solo te responderá a ti en este grupo.`
  }, { quoted: msg });
};

handler.command = ["addgrupo", "delgrupo"];
export default handler;
