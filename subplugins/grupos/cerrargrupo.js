// plugins/cerrargrupo.js
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
    console.error("[cerrargrupo] Error reading admins:", e);
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ *Este comando solo funciona en grupos.*" }, { quoted: msg });
  }

  // ✅ Obtener senderNo de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe = !!msg.key.fromMe;

  try { await conn.sendMessage(chatId, { react: { text: "🔒", key: msg.key } }); } catch {}

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
    return conn.sendMessage(chatId, {
      text: "🚫 Solo administradores u owners pueden usar este comando."
    }, { quoted: msg });
  }

  try {
    await conn.groupSettingUpdate(chatId, "announcement");
    await conn.sendMessage(chatId, {
      text: "🔒 *El grupo ha sido cerrado.*\n📢 *Solo los administradores pueden enviar mensajes ahora.*"
    }, { quoted: msg });
  } catch (e) {
    console.error("[cerrargrupo] error al cerrar:", e);
    await conn.sendMessage(chatId, { text: "❌ No pude cerrar el grupo." }, { quoted: msg });
  }
};

handler.command = ["cerrargrupo"];
export default handler;
