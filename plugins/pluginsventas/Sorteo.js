// plugins/sorteo.js
import { numeroDelRemitente, isOwnerCheck, isAdminByNumber } from '../../libs/adminCheck.js';
const DIGITS = (s = "") => String(s).replace(/\D/g, "");

/** Normaliza: si participante viene como @lid y trae .jid (real), usa .jid */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid) ? v.jid : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Devuelve el JID real (terminado en @s.whatsapp.net) para un id que podría ser @lid */
function resolveRealFromId(id, partsRaw, partsNorm) {
  if (typeof id !== "string") return null;
  if (id.endsWith("@s.whatsapp.net")) return id;
  if (!id.endsWith("@lid")) return null;

  const idx = partsRaw.findIndex(p => p?.id === id);
  if (idx >= 0) {
    const r = partsRaw[idx];
    if (typeof r?.jid === "string" && r.jid.endsWith("@s.whatsapp.net")) return r.jid;
    const maybe = partsNorm[idx]?.id;
    if (typeof maybe === "string" && maybe.endsWith("@s.whatsapp.net")) return maybe;
  }
  const hit = partsNorm.find(n => n?.raw?.id === id && typeof n?.id === "string" && n.id.endsWith("@s.whatsapp.net"));
  return hit ? hit.id : null;
}

const handler = async (msg, { conn, args }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  // numeroDelRemitente resuelve los @lid; con el participant a secas los
  // admins de esos grupos no se reconocían.
  const senderNo = numeroDelRemitente(msg);
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo puede usarse en grupos." }, { quoted: msg });
  }

  // Texto del premio (permite espacios)
  const text = (args || []).join(" ").trim();
  if (!text) {
    return conn.sendMessage(chatId, {
      text: `✳️ Usa el comando así:\n\n*.sorteo [premio o motivo]*\nEjemplo:\n*.sorteo Carro Fino*`
    }, { quoted: msg });
  }

  // Metadata y normalización LID
  const meta     = await conn.groupMetadata(chatId);
  const partsRaw = Array.isArray(meta?.participants) ? meta.participants : [];
  const partsNorm = lidParser(partsRaw);

  // Bot JID / número real
  const botNo  = DIGITS(conn.user?.id || "");
  const botJid = `${botNo}@s.whatsapp.net`;

  // ¿Sender es admin / owner?
  const isAdmin   = await isAdminByNumber(conn, chatId, senderNo);
  const isOwner   = isOwnerCheck(senderNo);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "❌ Solo *admins* o *el dueño del bot* pueden usar este comando."
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '🎲', key: msg.key } });

  // Construir lista de participantes elegibles:
  // - JID real (@s.whatsapp.net)
  // - excluir admins
  // - excluir el bot
  const elegibles = [];
  for (let i = 0; i < partsRaw.length; i++) {
    const realId = partsNorm[i]?.id || resolveRealFromId(partsRaw[i]?.id, partsRaw, partsNorm) || partsRaw[i]?.jid || partsRaw[i]?.id;
    if (!realId || !realId.endsWith("@s.whatsapp.net")) continue;

    const num = DIGITS(realId);
    const esAdmin = adminNums.has(num);
    const esBot   = (num === botNo);

    if (!esAdmin && !esBot) elegibles.push(realId);
  }

  if (!elegibles.length) {
    return conn.sendMessage(chatId, {
      text: "⚠️ No hay suficientes participantes para hacer el sorteo."
    }, { quoted: msg });
  }

  const ganador = elegibles[Math.floor(Math.random() * elegibles.length)];

  // Animación con edición
  const pasos = [
    "🎁 Preparando el sorteo...",
    "🎰 Revolviendo nombres...",
    "🌀 Cargando suerte...",
    "🎯 Apuntando al ganador..."
  ];

  const tempMsg = await conn.sendMessage(chatId, { text: pasos[0] }, { quoted: msg });

  for (let i = 1; i < pasos.length; i++) {
    await new Promise(r => setTimeout(r, 1500));
    await conn.sendMessage(chatId, { edit: tempMsg.key, text: pasos[i] });
  }

  await new Promise(r => setTimeout(r, 1500));
  await conn.sendMessage(chatId, {
    edit: tempMsg.key,
    text: `🎉 *SORTEO REALIZADO*\n\n🏆 *Premio:* ${text}\n👑 *Ganador:* @${DIGITS(ganador)}`,
    mentions: [ganador]
  });
};

handler.command = ['sorteo'];
export default handler;
