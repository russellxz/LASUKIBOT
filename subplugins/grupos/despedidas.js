// subplugins/grupos/despedidas.js — Activa/desactiva las despedidas del SUBBOT
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

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(String(senderId).split(":")[0]));
  const isFromMe = !!msg.key.fromMe;
  const p = conn?.subPrefixes?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "📢", key: msg.key } }).catch(() => {});

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo puede usarse en grupos." }, { quoted: msg });
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  if (!isAdmin && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores o el dueño del subbot pueden usar este comando."
    }, { quoted: msg });
  }

  const estado = (args?.[0] || "").toLowerCase();
  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, { text: `✳️ Usa correctamente:\n\n${p}despedidas on / off` }, { quoted: msg });
  }

  const data = conn.readSubData("welcome.json", {});
  if (!data[chatId]) data[chatId] = {};
  if (estado === "on") data[chatId].despedidas = 1;
  else delete data[chatId].despedidas;
  conn.writeSubData("welcome.json", data);

  await conn.sendMessage(chatId, {
    text: `🚪 Despedidas del subbot *${estado === "on" ? "activadas" : "desactivadas"}* correctamente.`
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
};

handler.command = ["despedidas", "despedida"];
export default handler;
