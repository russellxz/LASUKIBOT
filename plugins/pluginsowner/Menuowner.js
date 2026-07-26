// plugins/pluginsowner/Menuowner.js — Menú de comandos exclusivos del owner.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = global.prefixes?.[0] || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "👑", key: msg.key } }, msg); } catch {}

  return enviarMenu(conn, chatId, msg, "menuowner", {
    titulo: "MENÚ DE OWNER",
    info: [["Prefijo actual", p]],
    secciones: [
      {
        titulo: "🎨 PERSONALIZACIÓN",
        items: [
          `${p}setmenu — diseño, imagen, nombre y foto`,
          `${p}delmenu — dejar todo de fábrica`,
          `${p}botones on/off`
        ]
      },
      {
        titulo: "🧩 COMANDOS EXCLUSIVOS",
        items: [
          `${p}bc`,
          `${p}bc2`,
          `${p}rest`,
          `${p}carga`,
          `${p}modoprivado on/off`,
          `${p}botfoto`,
          `${p}botname`,
          `${p}setprefix`,
          `${p}git`,
          `${p}re`,
          `${p}unre`,
          `${p}autoadmins`,
          `${p}antideletepri on/off`,
          `${p}apagado`,
          `${p}addlista`,
          `${p}dellista`,
          `${p}vergrupos`,
          `${p}addowner`,
          `${p}delowner`,
          `${p}dar`,
          `${p}deleterpg`
        ]
      },
      {
        titulo: "💳 FACTURACIÓN",
        items: [`${p}addfactura`, `${p}delfactura`, `${p}facpaga`, `${p}verfac`]
      }
    ],
    nota: "Modo Dios activado 👑"
  });
};

handler.command = ["menuowner", "ownermenu"];
handler.help = ["menuowner"];
handler.tags = ["menu"];

export default handler;
