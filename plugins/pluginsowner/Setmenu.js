// plugins/pluginsowner/Setmenu.js — Personalización del bot principal.
// Solo owners (o el propio bot). Todo se maneja desde aquí: diseño de los
// menús y de las descargas, imagen/video, nombre y foto de perfil.
import { abrirSetmenu } from "../../setmenu-core.js";

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// Permiso: owner o el propio bot (se usa también para las respuestas del menú)
function puedeUsar(m, conn) {
  if (m?.key?.fromMe) return true;
  const num = DIGITS(m?.key?.participant || m?.key?.remoteJid);
  if (!num) return false;
  const botID = DIGITS(conn?.user?.id);
  if (num === botID) return true;
  return typeof global.isOwner === "function" ? !!global.isOwner(num) : false;
}

const handler = async (msg, { conn, args }) => {
  if (!puedeUsar(msg, conn)) {
    try { await conn.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "🚫 Este comando solo puede usarlo un *Owner* o el *mismo bot*." },
      { quoted: msg }
    );
  }

  return abrirSetmenu(msg, conn, { puedeUsar, args });
};

handler.command = ["setmenu", "personalizar"];
export default handler;
