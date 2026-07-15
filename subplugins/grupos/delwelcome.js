// subplugins/grupos/delwelcome.js — Borra bienvenida/despedida personalizadas del SUBBOT
// Config independiente por subbot: subbots/data/<numero>/welcome.json
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];
    const adminNums = new Set();
    for (const p of rawParts) {
      const flagAdmin = p.admin === "admin" || p.admin === "superadmin";
      if (!flagAdmin) continue;
      for (const id of [p.id, p.jid, p.pn, p.phoneNumber]) {
        const s = String(id || "");
        if (s.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(s.split(":")[0]));
      }
      if (typeof conn.lidParser === "function") {
        const normed = conn.lidParser([p]);
        const nid = String(normed?.[0]?.id || "");
        if (nid.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(nid.split(":")[0]));
      }
    }
    return adminNums.has(number);
  } catch {
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(String(senderId).split(":")[0]));
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo puede usarse en grupos." }, { quoted: msg });
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  if (!isAdmin && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo administradores o el dueño del subbot pueden eliminar los mensajes personalizados."
    }, { quoted: msg });
  }

  const data = conn.readSubData("welcome.json", {});
  if (!data[chatId] || (!data[chatId].bienvenida && !data[chatId].despedida)) {
    return conn.sendMessage(chatId, {
      text: "ℹ️ Este grupo no tiene mensajes personalizados activos en este subbot."
    }, { quoted: msg });
  }

  delete data[chatId].bienvenida;
  delete data[chatId].despedida;
  if (Object.keys(data[chatId]).length === 0) delete data[chatId];
  conn.writeSubData("welcome.json", data);

  await conn.sendMessage(chatId, {
    text: "🧹 Mensajes de bienvenida y despedida personalizados del subbot eliminados con éxito."
  }, { quoted: msg });
};

handler.command = ["delwelcome"];
export default handler;
