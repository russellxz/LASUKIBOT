// subplugins/setmenu.js — Personalización del subbot.
// 🚫 Solo lo puede usar el mismo subbot (fromMe), igual que addgrupo/addlista.
// Desde aquí se cambia el diseño de los menús y las descargas, la imagen o
// video de cada menú, el nombre del bot y la foto de perfil.
import { abrirSetmenu } from "../setmenu-core.js";

// Solo el dueño del subbot (su propio número conectado)
const puedeUsar = (m) => !!m?.key?.fromMe;

const handler = async (msg, { conn, args }) => {
  if (!puedeUsar(msg)) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede personalizarlo." },
      { quoted: msg }
    );
  }

  return abrirSetmenu(msg, conn, { puedeUsar, args });
};

handler.command = ["setmenu", "personalizar"];
export default handler;
