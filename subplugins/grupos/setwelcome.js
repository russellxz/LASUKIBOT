// subplugins/grupos/setwelcome.js — Bienvenida personalizada por SUBBOT
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

/** Extrae texto del mensaje citado (maneja wrappers comunes) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  return (
    q.conversation ||
    q?.extendedTextMessage?.text ||
    q?.ephemeralMessage?.message?.conversation ||
    q?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    null
  );
}

const handler = async (msg, { conn, args, text }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(String(senderId).split(":")[0]));
  const isFromMe = !!msg.key.fromMe;
  const p = conn?.subPrefixes?.[0] || ".";

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo se puede usar en grupos." }, { quoted: msg });
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  if (!isAdmin && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores o el dueño del subbot pueden personalizar la bienvenida."
    }, { quoted: msg });
  }

  let nuevo = (text || "").trim();
  if (!nuevo) nuevo = (args || []).join(" ").trim();
  if (!nuevo) nuevo = (getQuotedText(msg) || "").trim();

  if (!nuevo) {
    return conn.sendMessage(chatId, {
      text: `✳️ Usa:\n${p}setwelcome <mensaje>\n\nEjemplos:\n• ${p}setwelcome Bienvenid@ a nuestro grupo 💖\n• Responde a un mensaje con ${p}setwelcome`
    }, { quoted: msg });
  }

  const data = conn.readSubData("welcome.json", {});
  if (!data[chatId]) data[chatId] = {};
  data[chatId].bienvenida = nuevo;
  conn.writeSubData("welcome.json", data);

  await conn.sendMessage(chatId, { text: "✅ Mensaje de bienvenida del subbot guardado correctamente." }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
};

handler.command = ["setwelcome"];
export default handler;
