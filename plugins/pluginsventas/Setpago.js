import fs from 'fs';
import path from 'path';
import { isAdminByNumber, numeroDelRemitente, isOwnerCheck } from '../../libs/adminCheck.js';

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


/** Extrae texto de un mensaje citado (manteniendo saltos/espacios) */
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

/** Desencapsula viewOnce/ephemeral */
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

/** Asegura acceso a wa.downloadContentFromMessage */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, text, args, wa }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  // numeroDelRemitente resuelve los @lid; con el participant a secas los
  // admins de esos grupos no se reconocían.
  const senderNum = numeroDelRemitente(msg);
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  // Permisos: admin / owner / bot (LID-aware)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);
  const isOwner = isOwnerCheck(senderNum);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, { text: "🚫 Este comando solo puede ser usado por administradores." }, { quoted: msg });
  }

  // ——— Texto crudo (preserva saltos/espacios) ———
  const rawFromDispatcher = typeof text === "string" ? text : "";
  const textoCrudo = rawFromDispatcher.startsWith(" ") ? rawFromDispatcher.slice(1) : rawFromDispatcher;

  // Si no escribió texto, usamos el del mensaje citado (si existe).
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;

  // Imagen citada opcional (desencapsulada)
  const ctx  = msg.message?.extendedTextMessage?.contextInfo;
  const qRaw = ctx?.quotedMessage;
  const inner = qRaw ? unwrapMessage(qRaw) : null;
  const quotedImage = inner?.imageMessage;

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(chatId, {
      text: `✏️ Usa el comando así:\n\n• *setpago <texto>*  (multilínea permitido)\n• O responde a una *imagen* y escribe: *setpago <texto>*`
    }, { quoted: msg });
  }

  // Asegurar wa
  const WA = ensureWA(wa, conn);

  // Cargar JSON primero para poder preservar imagen previa si no envían nueva
  const filePath = "./ventas365.json";
  let ventas = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  if (!ventas[chatId]) ventas[chatId] = {};
  const prev = ventas[chatId]["setpago"] || {};

  // Procesar imagen (si viene citada)
  let imagenBase64 = null;
  if (quotedImage && WA) {
    try {
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setpago] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");

  // Guardar (conserva imagen previa si no hay nueva)
  ventas[chatId]["setpago"] = {
    texto: textoFinal,                       // EXACTO (con \n y espacios)
    imagen: imagenBase64 ?? prev.imagen ?? null
  };

  fs.writeFileSync(filePath, JSON.stringify(ventas, null, 2));

  await conn.sendMessage(chatId, { text: "✅ *DATOS DE PAGO actualizados.*" }, { quoted: msg });
};

handler.command = ["setpago"];
export default handler;
