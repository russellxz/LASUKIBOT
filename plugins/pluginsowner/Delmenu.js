// plugins/pluginsowner/Delmenu.js — Borra TODA la personalización del bot
// principal (diseño, nombre e imágenes) y lo deja de fábrica.
// Pide confirmación antes de borrar. Solo owners o el propio bot.
import { abrirDelmenu } from "../../setmenu-core.js";

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function puedeUsar(m, conn) {
  if (m?.key?.fromMe) return true;
  const num = DIGITS(m?.key?.participant || m?.key?.remoteJid);
  if (!num) return false;
  const botID = DIGITS(conn?.user?.id);
  if (num === botID) return true;
  return typeof global.isOwner === "function" ? !!global.isOwner(num) : false;
}

const handler = async (msg, { conn }) => {
  if (!puedeUsar(msg, conn)) {
    try { await conn.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "🚫 Este comando solo puede usarlo un *Owner* o el *mismo bot*." },
      { quoted: msg }
    );
  }

  return abrirDelmenu(msg, conn, { puedeUsar });
};

handler.command = ["delmenu"];
export default handler;
