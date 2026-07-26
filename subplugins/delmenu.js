// subplugins/delmenu.js — Borra TODA la personalización del subbot (diseño,
// nombre e imágenes) y lo deja de fábrica. Pide confirmación antes.
// 🚫 Solo lo puede usar el mismo subbot (fromMe).
import { abrirDelmenu } from "../setmenu-core.js";

const puedeUsar = (m) => !!m?.key?.fromMe;

const handler = async (msg, { conn }) => {
  if (!puedeUsar(msg)) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede usar este comando." },
      { quoted: msg }
    );
  }

  return abrirDelmenu(msg, conn, { puedeUsar });
};

handler.command = ["delmenu"];
export default handler;
