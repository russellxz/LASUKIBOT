// plugins/setname.js
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
    console.error("[setname] Error reading admins:", e);
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
    q?.viewOnceMessageV2?.message?.conversation ||
    q?.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
    q?.viewOnceMessageV2Extension?.message?.conversation ||
    q?.viewOnceMessageV2Extension?.message?.extendedTextMessage?.text ||
    null
  );
}

const handler = async (msg, { conn, args }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  
  // ✅ Obtener senderNo de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo se puede usar en grupos.*" }, { quoted: msg });
    return;
  }

  // Permisos: admin (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  // Owners desde owner.json (fallback a global.owner) + validación robusta
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath)
    ? JSON.parse(fs.readFileSync(ownerPath, "utf-8"))
    : (global.owner || []);
    
  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores u owners pueden cambiar el nombre del grupo.*"
    }, { quoted: msg });
    return;
  }

  // Nombre: args o texto citado
  let nuevoNombre = (args || []).join(" ").trim();
  if (!nuevoNombre) {
    const qtext = (getQuotedText(msg) || "").trim();
    if (qtext) nuevoNombre = qtext;
  }

  if (!nuevoNombre) {
    await conn.sendMessage(chatId, {
      text: "ℹ️ *Debes escribir o responder con el nuevo nombre del grupo.*\n\nEjemplos:\n• *.setname La Familia de Suki 💕*\n• Responde a un mensaje con *.setname*"
    }, { quoted: msg });
    return;
  }

  // Evitar errores por longitud (WhatsApp suele aceptar ~100 chars)
  nuevoNombre = nuevoNombre.slice(0, 100);

  try {
    await conn.sendMessage(chatId, { react: { text: "✏️", key: msg.key } }).catch(() => {});
    await conn.groupUpdateSubject(chatId, nuevoNombre);

    await conn.sendMessage(chatId, {
      text: `✅ *Nombre del grupo actualizado con éxito.*\n\n📝 *Nuevo nombre:*\n${nuevoNombre}`
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  } catch (error) {
    console.error("❌ Error al cambiar el nombre del grupo:", error);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al cambiar el nombre del grupo.*"
    }, { quoted: msg });
  }
};

handler.command = ["setname"];
export default handler;
