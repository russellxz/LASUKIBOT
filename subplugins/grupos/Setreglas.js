// plugins/setreglas.js
import fs from 'fs';
import path from 'path';

// ——— Helpers LID-aware ———
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
    console.error("[setreglas] Error reading admins:", e);
    return false;
  }
}

/** Desencapsula viewOnce/ephemeral y retorna el mensaje interno real */
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

/** Extrae texto del mensaje citado (manteniendo saltos/espacios) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.conversation || inner?.extendedTextMessage?.text || null;
}

/** Extrae imageMessage del citado (soporta ephemeral/viewOnce) */
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

const handler = async (msg, { conn, text, args, wa }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  
  // ✅ Obtener senderNum de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNum = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ *Este comando solo se puede usar en grupos.*" }, { quoted: msg });
  }

  // Permisos: admin u owner (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);
  const isOwner = Array.isArray(global.owner) && global.owner.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNum;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo administradores u owner pueden usar este comando."
    }, { quoted: msg });
  }

  // ——— Texto crudo (preserva saltos/espacios) ———
  const rawFromDispatcher = typeof text === "string" ? text : "";
  const textoCrudo = rawFromDispatcher.startsWith(" ") ? rawFromDispatcher.slice(1) : rawFromDispatcher;

  // Además, si el user respondió a un texto, podemos usarlo (solo si no escribió nada tras el comando)
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;

  // Imagen citada (opcional; soporta viewOnce/ephemeral)
  const quotedImage = getQuotedImageMessage(msg);

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(chatId, {
      text: `✏️ Usa el comando así:\n\n• *setreglas <texto>* (multilínea permitido)\n• O responde a una *imagen* (opcional) y escribe: *setreglas <texto>*`
    }, { quoted: msg });
  }

  // Si hay imagen citada, la convertimos a base64
  let imagenBase64 = null;
  if (quotedImage) {
    try {
      const WA = ensureWA(wa, conn);
      if (!WA) throw new Error("downloadContentFromMessage no disponible");
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setreglas] error leyendo imagen citada:", e);
    }
  }

  // Texto final (conserva formato exactamente como escribió el user)
  const textoFinal = (textoCrudo || quotedText || "");

  const filePath = path.join(conn.subDataDir, "reglas365.json");
  let ventas = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  if (!ventas[chatId]) ventas[chatId] = {};

  ventas[chatId]["setreglas"] = {
    texto: textoFinal,   // tal cual (con \n y espacios)
    imagen: imagenBase64 // base64 o null
  };

  fs.writeFileSync(filePath, JSON.stringify(ventas, null, 2));

  await conn.sendMessage(chatId, { text: "✅ *REGLAS del grupo actualizadas con éxito.*" }, { quoted: msg });
};

handler.command = ["setreglas"];
export default handler;
