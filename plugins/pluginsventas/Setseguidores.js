"use strict";

import fs from 'fs';
import path from 'path';
import { isAdminByNumber, numeroDelRemitente, isOwnerCheck } from '../../libs/adminCheck.js';

// (helpers idénticos a setlotes)
const DIGITS = (s = "") => String(s).replace(/\D/g, "");
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid) ? v.jid : v.id,
      admin: v?.admin ?? null
    }));
  } catch { return participants || []; }
}
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
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.conversation || inner?.extendedTextMessage?.text || null;
}
function getQuotedImageMessage(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.imageMessage || null;
}
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}
const DB_PATH = path.resolve("./ventas365.json");
function loadJsonSafe() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch { return {}; }
}
function saveJsonAtomic(obj) {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  // numeroDelRemitente resuelve los @lid; con el participant a secas los
  // admins de esos grupos no se reconocían.
  const senderNum = numeroDelRemitente(msg);
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) return conn.sendMessage(chatId, { text: "❌ Este comando solo funciona en grupos." }, { quoted: msg });

  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);
  const owners  = Array.isArray(global.owner) ? global.owner : [];
  const isOwner = isOwnerCheck(senderNum);
  if (!isAdmin && !isOwner && !isFromMe)
    return conn.sendMessage(chatId, { text: "🚫 Este comando solo puede ser usado por administradores." }, { quoted: msg });

  const textoArg   = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoCrudo = textoArg;
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;
  const quotedImage = getQuotedImageMessage(msg);

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(
      chatId,
      { text: "✏️ Usa: *setseguidores <texto>* (multilínea) o responde a una *imagen* con: *setseguidores <texto>*" },
      { quoted: msg }
    );
  }

  let imagenBase64 = null;
  if (quotedImage) {
    try {
      const WA = ensureWA(wa, conn);
      if (!WA) throw new Error("Baileys no inyectado.");
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const c of stream) buffer = Buffer.concat([buffer, c]);
      if (buffer.length > MAX_IMAGE_BYTES)
        return conn.sendMessage(chatId, { text: "⚠️ La imagen es muy grande (máx 8 MB)." }, { quoted: msg });
      imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setseguidores] imagen:", e);
      return conn.sendMessage(chatId, { text: "❌ No pude leer la imagen citada." }, { quoted: msg });
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");
  const db = loadJsonSafe();
  if (!db[chatId]) db[chatId] = {};
  db[chatId]["setseguidores"] = { texto: textoFinal, imagen: imagenBase64 };
  saveJsonAtomic(db);

  await conn.sendMessage(chatId, { text: "✅ *SEGUIDORES actualizado con éxito.*" }, { quoted: msg });
};

handler.command = ["setseguidores"];
export default handler;
