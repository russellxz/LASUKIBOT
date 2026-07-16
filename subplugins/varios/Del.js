import fs from 'fs';
import { isAdminInGroup, isOwnerCheck } from '../../libs/adminCheck.js';
import path from 'path';
import { guarPaths } from './_guarpaths.js';

function getPaqueteCandidates(paquete) {
  const clean = String(paquete || "").trim().toLowerCase();
  const withoutDot = clean.replace(/^\.+/, "");

  if (!clean) return [];

  if (clean.startsWith(".")) {
    return [...new Set([clean, withoutDot])];
  }

  return [...new Set([clean, `.${clean}`])];
}

function resolveKey(db, paquete) {
  const candidates = getPaqueteCandidates(paquete);

  for (const key of candidates) {
    if (Array.isArray(db[key])) return key;
  }

  return paquete;
}

const handler = async (msg, { conn, args }) => {
  const { guarJson: RUTA_VIEJA, filesDb: RUTA_NUEVA } = guarPaths(conn);
  const chatId = msg.key.remoteJid;
  const sender = (msg.key.participant || msg.key.remoteJid).replace(/\D/g, "");
  const isGroup = chatId.endsWith("@g.us");
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } });

  // ====== Parsear argumentos: último = número, el resto = palabra clave ======
  // Ejemplos:
  //   .del hola 2           → paquete="hola", index=2
  //   .del .hola 2          → paquete=".hola", index=2
  //   .del guar 1           → también busca ".guar"
  //   .del mi saludo 1      → paquete="mi saludo", index=1
  const argsArr = Array.isArray(args) ? args : [];
  const lastArg = argsArr[argsArr.length - 1];
  const index = parseInt(lastArg);
  const paquete = argsArr.slice(0, -1).join(" ").trim().toLowerCase();

  if (!paquete || isNaN(index) || argsArr.length < 2) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❗ Usa correctamente:\n*${pref}del <paquete> <número>*\n\nEjemplos:\n• ${pref}del hola 2\n• ${pref}del .hola 1\n• ${pref}del guar 1\n• ${pref}del .guar 1`,
    }, { quoted: msg });
  }

  // ====== Cargar ambas bases de datos ======
  let dbVieja = {};
  let dbNueva = {};

  if (fs.existsSync(RUTA_VIEJA)) {
    try { dbVieja = JSON.parse(fs.readFileSync(RUTA_VIEJA, "utf-8")); } catch { dbVieja = {}; }
  }

  if (fs.existsSync(RUTA_NUEVA)) {
    try { dbNueva = JSON.parse(fs.readFileSync(RUTA_NUEVA, "utf-8")); } catch { dbNueva = {}; }
  }

  // NUEVO:
  // Permite borrar paquetes guardados con punto.
  // Si pones ".del guar 1" y existe ".guar", lo encuentra.
  // Si pones ".del .guar 1", también lo encuentra.
  const paqueteViejoReal = resolveKey(dbVieja, paquete);
  const paqueteNuevoReal = resolveKey(dbNueva, paquete);

  const itemsViejos = Array.isArray(dbVieja[paqueteViejoReal]) ? dbVieja[paqueteViejoReal] : [];
  const itemsNuevos = Array.isArray(dbNueva[paqueteNuevoReal]) ? dbNueva[paqueteNuevoReal] : [];
  const total = itemsViejos.length + itemsNuevos.length;

  if (total === 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `⚠️ No existe el paquete *"${paquete}"*.\nTambién busqué si estaba guardado como *".${paquete.replace(/^\.+/, "")}"*.`,
    }, { quoted: msg });
  }

  if (index < 1 || index > total) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `⚠️ Número inválido.\nEl paquete *"${paquete}"* tiene *${total}* archivo(s).\nUsa un número del *1* al *${total}*.`,
    }, { quoted: msg });
  }

  // ====== Determinar de dónde viene el item seleccionado ======
  // Los viejos van primero (índices 1 a itemsViejos.length),
  // los nuevos después (itemsViejos.length+1 en adelante).
  let target, origen, idxLocal;
  if (index <= itemsViejos.length) {
    target = itemsViejos[index - 1];
    origen = "vieja";
    idxLocal = index - 1;
  } else {
    idxLocal = index - itemsViejos.length - 1;
    target = itemsNuevos[idxLocal];
    origen = "nueva";
  }

  // Retrocompatibilidad: el campo puede llamarse "de" (viejo) o "user" (nuevo)
  const targetUser = target.de || target.user;

  // ====== Protección de permisos (igual que antes) ======
  const isAdmin = isGroup ? await isAdminInGroup(conn, chatId, msg.realJid || msg.key.participant || msg.key.remoteJid) : false;
  const esOwner = isOwnerCheck(msg.realJid || msg.key.participant || msg.key.remoteJid) || global.isOwner(sender);
  const esDueñoDelArchivo = targetUser === sender;
  const archivoEsDeOwner = global.owner.some(([o]) => o === targetUser);

  if (!esOwner && !esDueñoDelArchivo && (!isAdmin || archivoEsDeOwner)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `🚫 No tienes permiso para eliminar ese archivo.`,
    }, { quoted: msg });
  }

  // ====== Eliminar del archivo correcto ======
  try {
    if (origen === "vieja") {
      dbVieja[paqueteViejoReal].splice(idxLocal, 1);

      if (dbVieja[paqueteViejoReal].length === 0) {
        delete dbVieja[paqueteViejoReal];
      }

      fs.writeFileSync(RUTA_VIEJA, JSON.stringify(dbVieja, null, 2));
    } else {
      const eliminado = dbNueva[paqueteNuevoReal].splice(idxLocal, 1)[0];

      if (dbNueva[paqueteNuevoReal].length === 0) {
        delete dbNueva[paqueteNuevoReal];
      }

      fs.writeFileSync(RUTA_NUEVA, JSON.stringify(dbNueva, null, 2));

      // También borrar el archivo físico de la carpeta guar_media/
      if (eliminado?.path) {
        try {
          const filePath = path.resolve(eliminado.path);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
      }
    }
  } catch (e) {
    console.error("[del] error al escribir:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al guardar los cambios.`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  const paqueteReal = origen === "vieja" ? paqueteViejoReal : paqueteNuevoReal;

  return conn.sendMessage(chatId, {
    text: `✅ Archivo número *${index}* eliminado del paquete: *${paqueteReal}*`
  }, { quoted: msg });
};

handler.command = ["del"];
export default handler;
