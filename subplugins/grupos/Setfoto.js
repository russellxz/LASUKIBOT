// plugins/setfoto.js
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
    console.error("[setfoto] Error reading admins:", e);
    return false;
  }
}

/** Desencapsula viewOnce/ephemeral para acceder al mensaje real */
function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

/** Extrae la imageMessage del citado (soporta viewOnce/ephemeral) */
function getQuotedImageMessage(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.imageMessage || null;
}

/** Asegura acceso a wa.downloadContentFromMessage inyectado */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  
  // ✅ Obtener senderNo de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo se puede usar en grupos.*" }, { quoted: msg });
    return;
  }

  // Permisos: admin (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  
  // Owners desde owner.json (fallback a global.owner) + validación robusta
  const ownersPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownersPath) ? JSON.parse(fs.readFileSync(ownersPath, "utf-8")) : (global.owner || []);
  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "🚫 *Solo administradores o el Owner pueden cambiar la foto del grupo.*"
    }, { quoted: msg });
    return;
  }

  const quotedImage = getQuotedImageMessage(msg);
  if (!quotedImage) {
    await conn.sendMessage(chatId, {
      text: "⚠️ *Debes responder a una imagen para cambiar la foto del grupo.*"
    }, { quoted: msg });
    return;
  }

  const WA = ensureWA(wa, conn);
  if (!WA) {
    await conn.sendMessage(chatId, {
      text: "❌ *No se pudo acceder a la función de descarga de Baileys (`downloadContentFromMessage`).*"
    }, { quoted: msg });
    return;
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } }).catch(() => {});
    const stream = await WA.downloadContentFromMessage(quotedImage, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    if (!buffer?.length) throw new Error("Buffer vacío al leer la imagen citada");

    // Baileys v6/v7: intentar nuevo formato primero y caer al antiguo si falla
    try {
      await conn.updateProfilePicture(chatId, { image: buffer });
    } catch (e1) {
      // Fallback (algunas versiones aceptan buffer directo)
      await conn.updateProfilePicture(chatId, buffer);
    }

    await conn.sendMessage(chatId, {
      text: "✅ *La foto del grupo ha sido actualizada con éxito.*"
    }, { quoted: msg });
  } catch (err) {
    console.error("❌ Error al cambiar la foto del grupo:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Error al actualizar la foto del grupo.*"
    }, { quoted: msg });
  }
};

handler.command = ["setfoto"];
export default handler;
