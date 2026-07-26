// subplugins/menuowner.js — Menú de comandos de dueño del subbot.
// 🚫 Solo lo puede ver y usar el mismo subbot (fromMe), igual que addgrupo,
// addlista y setprefix. Los comandos que lista también son solo suyos.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) || ".";

  // Solo el dueño del subbot (el mismo número conectado)
  if (!msg.key.fromMe) {
    return conn.sendMessage(
      chatId,
      { text: "🚫 Este menú es solo para el *dueño del subbot* (el mismo número conectado)." },
      { quoted: msg }
    );
  }

  try { await conn.sendMessage(chatId, { react: { text: "👑", key: msg.key } }); } catch {}

  return enviarMenu(conn, chatId, msg, "menuowner", {
    titulo: "MENÚ DE OWNER",
    info: [["Prefijo actual", p]],
    secciones: [
      {
        titulo: "🎨 PERSONALIZACIÓN",
        items: [
          `${p}setmenu — diseño, imagen, nombre y foto`,
          `${p}delmenu — dejar todo de fábrica`
        ]
      },
      {
        titulo: "🤖 TU SUBBOT",
        items: [
          `${p}addgrupo / delgrupo — dónde responde a todos`,
          `${p}addlista / dellista — usuarios permitidos`,
          `${p}setprefix — cambiar tu prefijo`,
          `${p}reprefix — volver a . # /`,
          `${p}antideletepri on/off`,
          `${p}bots — ver los subbots conectados`,
          `${p}code +número — conectar otro subbot`
        ]
      },
      {
        titulo: "🛡️ EN TUS GRUPOS",
        items: [
          `${p}modoadmins on/off`,
          `${p}antilink on/off`,
          `${p}antis on/off`,
          `${p}antidelete on/off`,
          `${p}antiarabe on/off`,
          `${p}welcome / despedidas on/off`
        ]
      }
    ],
    nota: "Estos comandos solo funcionan desde tu propio número 👑"
  });
};

handler.command = ["menuowner", "ownermenu"];
export default handler;
