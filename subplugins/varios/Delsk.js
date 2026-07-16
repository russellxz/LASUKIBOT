// plugins/dels.js
// Elimina un sticker específico de un paquete guardado con .guars
// Uso: .dels <paquete> <número>
//   .dels memes 2              → elimina el sticker #2 del paquete "memes"
//   .dels hola fino 1          → elimina el #1 de "hola fino"

import fs from 'fs';
import { isAdminInGroup, isOwnerCheck } from '../../libs/adminCheck.js';
import path from 'path';


const handler = async (msg, { conn, args }) => {
  const PACKS_DB = path.join(conn?.subDataDir || process.cwd(), "guars_packs.json");
  const chatId = msg.key.remoteJid;
  const sender = (msg.key.participant || msg.key.remoteJid).replace(/\D/g, "");
  const isGroup = chatId.endsWith("@g.us");
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } });

  // ====== Parsear argumentos: último = número, el resto = nombre del paquete ======
  const argsArr = Array.isArray(args) ? args : [];
  const lastArg = argsArr[argsArr.length - 1];
  const index = parseInt(lastArg);
  const packName = argsArr.slice(0, -1).join(" ").trim().toLowerCase();

  if (!packName || isNaN(index) || argsArr.length < 2) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❗ Uso correcto:\n*${pref}delsk <paquete> <número>*\n\nEjemplos:\n• ${pref}delsk memes 2\n• ${pref}dels hola fino 1\n• ${pref}dels mis stickers 3`,
    }, { quoted: msg });
  }

  // ====== Cargar base de datos ======
  if (!fs.existsSync(PACKS_DB)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `⚠️ No hay paquetes de stickers guardados aún.`,
    }, { quoted: msg });
  }

  let db = {};
  try {
    db = JSON.parse(fs.readFileSync(PACKS_DB, "utf-8"));
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al leer la base de datos: \`${e.message}\``,
    }, { quoted: msg });
  }

  const pack = db[packName];
  if (!pack || !Array.isArray(pack.stickers) || pack.stickers.length === 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `⚠️ El paquete *"${packName}"* no existe o está vacío.`,
    }, { quoted: msg });
  }

  const total = pack.stickers.length;
  if (index < 1 || index > total) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `⚠️ Número inválido.\nEl paquete *"${packName}"* tiene *${total}* sticker${total !== 1 ? "s" : ""}.\nUsa un número del *1* al *${total}*.`,
    }, { quoted: msg });
  }

  // ====== Obtener el sticker seleccionado ======
  const target = pack.stickers[index - 1];
  const targetUser = target.addedBy || pack.createdBy;

  // ====== Protección de permisos ======
  const isAdmin = isGroup ? await isAdminInGroup(conn, chatId, msg.realJid || msg.key.participant || msg.key.remoteJid) : false;
  const esOwner = isOwnerCheck(msg.realJid || msg.key.participant || msg.key.remoteJid) || global.isOwner(sender);
  const esDueñoDelSticker = targetUser === sender;
  const stickerEsDeOwner = global.owner.some(([o]) => o === targetUser);

  if (!esOwner && !esDueñoDelSticker && (!isAdmin || stickerEsDeOwner)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `🚫 No tienes permiso para eliminar ese sticker.`,
    }, { quoted: msg });
  }

  // ====== Eliminar el sticker ======
  try {
    const eliminado = pack.stickers.splice(index - 1, 1)[0];

    // Si el paquete quedó vacío, eliminarlo entero
    if (pack.stickers.length === 0) {
      delete db[packName];
    }

    // Guardar DB actualizada
    fs.writeFileSync(PACKS_DB, JSON.stringify(db, null, 2));

    // Eliminar el archivo físico de la carpeta
    if (eliminado?.path) {
      try {
        const filePath = path.resolve(eliminado.path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  } catch (e) {
    console.error("[dels] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al eliminar: \`${e.message}\``,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  const restantes = db[packName]?.stickers?.length || 0;
  let texto = `✅ Sticker *#${index}* eliminado del paquete: *${packName}*`;
  if (restantes === 0) {
    texto += `\n📂 El paquete quedó vacío y fue eliminado.`;
  } else {
    texto += `\n📊 Stickers restantes: *${restantes}*`;
  }

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["delsk"];
export default handler;
