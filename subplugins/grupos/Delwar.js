import fs from 'fs';
import path from 'path';
import { getSenderPerms } from '../../libs/adminCheck.js';
import { rutaAvisos } from '../../libs/avisos.js';

/** Borra el grupo de un archivo de advertencias. Devuelve true si había algo. */
function limpiarArchivo(ruta, chatId) {
  try {
    if (!fs.existsSync(ruta)) return false;

    const datos = JSON.parse(fs.readFileSync(ruta, "utf-8"));
    if (!datos || !datos[chatId]) return false;

    delete datos[chatId];
    fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));
    return true;
  } catch (e) {
    console.error("[delwar] no pude limpiar", ruta, e.message);
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo se puede usar en grupos."
    }, { quoted: msg });
  }

  const { isAdmin, isOwner, fromMe } = await getSenderPerms(conn, msg);

  if (!isAdmin && !isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores pueden usar este comando."
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "🧹", key: msg.key } });

  // Las del antilink/antiárabe y las manuales de .warn viven en archivos
  // distintos, así que hay que limpiar los dos.
  const habiaAuto   = limpiarArchivo(path.join(conn.subDataDir, "advertencias.json"), chatId);
  const habiaManual = limpiarArchivo(rutaAvisos(conn), chatId);

  if (!habiaAuto && !habiaManual) {
    return conn.sendMessage(chatId, {
      text: "📁 No hay advertencias registradas aún."
    }, { quoted: msg });
  }

  return conn.sendMessage(chatId, {
    text: "✅ Todas las advertencias del grupo han sido eliminadas."
  }, { quoted: msg });
};

handler.command = ["delwar"];
export default handler;
