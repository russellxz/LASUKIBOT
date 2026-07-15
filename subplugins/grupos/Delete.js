// plugins/delete.js
import fs from 'fs';
import path from 'path';

// ✅ Patrón seguro para extraer solo números
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** Verifica admin por NÚMERO usando la lógica robusta (LID y no-LID) */
async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

    const adminNums = new Set();
    for (let i = 0; i < rawParts.length; i++) {
      let p = rawParts[i];
      let flagAdmin = p.admin === "admin" || p.admin === "superadmin";
      if (!flagAdmin) continue;

      let pid  = String(p.id  || "");
      let pjid = String(p.jid || "");

      // 1) Extracción directa de @s.whatsapp.net
      if (pid.endsWith("@s.whatsapp.net")) adminNums.add(pid.split(":")[0].replace(/[^0-9]/g, ""));
      if (pjid.endsWith("@s.whatsapp.net")) adminNums.add(pjid.split(":")[0].replace(/[^0-9]/g, ""));

      // 2) Resolución a través del lidMap
      if (pid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved = global.lidMap.get(pid);
        if (resolved && resolved.endsWith("@s.whatsapp.net")) adminNums.add(resolved.split(":")[0].replace(/[^0-9]/g, ""));
      }
      if (pjid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved2 = global.lidMap.get(pjid);
        if (resolved2 && resolved2.endsWith("@s.whatsapp.net")) adminNums.add(resolved2.split(":")[0].replace(/[^0-9]/g, ""));
      }

      // 3) Fallback usando conn.lidParser (si existe)
      if (typeof conn.lidParser === "function") {
        let normed = conn.lidParser([p]);
        if (normed && normed[0]) {
          let nid = String(normed[0].id || "");
          if (nid.endsWith("@s.whatsapp.net")) adminNums.add(nid.split(":")[0].replace(/[^0-9]/g, ""));
        }
      }
    }
    return adminNums.has(number);
  } catch (e) {
    console.error("[delete] Error reading admins:", e);
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  if (!isGroup) {
    await conn.sendMessage(chatId, {
      text: "❌ *Este comando solo se puede usar en grupos.*"
    }, { quoted: msg });
    return;
  }

  // ✅ Obtener senderNum de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  const isFromMe = !!msg.key.fromMe;

  // Permisos: admin (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  // Owners desde owner.json (fallback a global.owner) + validación robusta
  const ownerPath = path.resolve("owner.json");
  let owners = [];
  try { owners = JSON.parse(fs.readFileSync(ownerPath, "utf-8")); }
  catch { owners = global.owner || []; }

  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
    return;
  }

  // Verificar si hay un mensaje citado
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  if (!contextInfo?.stanzaId) {
    await conn.sendMessage(chatId, {
      text: "❓ *Debes responder al mensaje que deseas eliminar con el comando `.delete`.*"
    }, { quoted: msg });
    return;
  }

  const stanzaId = contextInfo.stanzaId;
  const quotedParticipant = contextInfo.participant || chatId;

  // Obtener el número del bot
  const botNum = DIGITS(conn.user?.id?.split(":")[0] || "");
  
  // ✅ Comprobar si el mensaje citado fue enviado por el bot
  const isBotMessage = DIGITS(quotedParticipant) === botNum;

  // ✅ Comprobar si el bot es administrador en el grupo
  const botIsAdmin = await isAdminByNumber(conn, chatId, botNum);

  // Si el mensaje NO es del bot y el bot NO es admin, no puede borrarlo
  if (!isBotMessage && !botIsAdmin) {
    await conn.sendMessage(chatId, {
      text: "⚠️ *No soy administrador en este grupo, por lo que solo puedo eliminar mis propios mensajes.*"
    }, { quoted: msg });
    return;
  }

  try {
    await conn.sendMessage(chatId, {
      delete: {
        remoteJid: chatId,
        fromMe: isBotMessage, // ✅ true si es del bot, false si es de otro
        id: stanzaId,
        participant: quotedParticipant
      }
    });

    await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } }).catch(() => {});

  } catch (e) {
    console.error("❌ Error al eliminar mensaje:", e);
    await conn.sendMessage(chatId, {
      text: "❌ *No se pudo eliminar el mensaje. Es posible que sea demasiado antiguo o haya un problema de permisos.*"
    }, { quoted: msg });
  }
};

handler.command = ["delete", "del"];
export default handler;
