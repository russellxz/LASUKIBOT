import fs from 'fs';
import path from 'path';
import { isAdminByNumber } from '../../libs/adminCheck.js';

// ——— Helpers LID-aware ———
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


/** Desencapsula viewOnce/ephemeral y retorna el nodo interno */
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

/** Extrae texto del citado (preserva saltos/espacios) */
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

/** Obtiene wa.downloadContentFromMessage desde donde esté inyectado */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  const senderJid = msg.key.participant || msg.key.remoteJid; // puede ser @lid
  const senderNum = DIGITS(senderJid);
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  // Permisos: admin / owner / bot (LID-aware)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);
  const isOwner = Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, { text: "🚫 Este comando solo puede ser usado por administradores." }, { quoted: msg });
  }

  // ——— Texto crudo (NO trim; preserva \n y espacios) ———
  const textoArg   = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoCrudo = textoArg;

  // Texto del citado si no escribieron nada
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;

  // ¿Imagen citada? (desencapsulada)
  const quotedImage = getQuotedImageMessage(msg);

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(
      chatId,
      { text: "✏️ Usa el comando así:\n\n• *setsoporte <texto>* (multilínea permitido)\n• O responde a una *imagen* con: *setsoporte <texto>*" },
      { quoted: msg }
    );
  }

  // Descargar imagen si fue citada
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
      console.error("[setsoporte] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");

  // Guardar EXACTO
  const filePath = "./ventas365.json";
  let ventas = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  if (!ventas[chatId]) ventas[chatId] = {};
  ventas[chatId]["setsoporte"] = {
    texto: textoFinal,   // Se guarda tal cual
    imagen: imagenBase64 // null si no hay imagen
  };

  fs.writeFileSync(filePath, JSON.stringify(ventas, null, 2));
  await conn.sendMessage(chatId, { text: "✅ *DATOS DE SOPORTE actualizados.*" }, { quoted: msg });
};

handler.command = ["setsoporte"];
export default handler;
