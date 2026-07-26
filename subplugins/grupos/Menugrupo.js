// subplugins/grupos/Menugrupo.js — Menú de grupos del subbot.
// El diseño, la imagen/video y el nombre salen de la personalización del
// propio subbot (comando setmenu).
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) || ".";

  try { await conn.sendMessage(chatId, { react: { text: "💠", key: msg.key } }); } catch {}

  return enviarMenu(conn, chatId, msg, "menugrupo", {
    titulo: "MENÚ DE GRUPOS",
    info: [["Prefijo actual", p]],
    secciones: [
      {
        titulo: "🛠️ CONFIGURACIONES",
        items: [
          `${p}reaccion off / on`,
          `${p}infogrupo`,
          `${p}setinfo`,
          `${p}setname`,
          `${p}setwelcome`,
          `${p}delwelcome (borra despedidas también)`,
          `${p}setdespedidas`,
          `${p}setfoto`,
          `${p}setreglas`,
          `${p}reglas`,
          `${p}welcome on/off`,
          `${p}despedidas on/off`,
          `${p}modoadmins on/off`,
          `${p}antilink on/off`,
          `${p}linkall on/off`,
          `${p}antis on/off`,
          `${p}antidelete on/off`,
          `${p}antiarabe on/off`,
          `${p}configrupo`,
          `${p}addco (comando a sticker)`,
          `${p}delco (elimina comandos en s)`
        ]
      },
      {
        titulo: "🛡️ ADMINISTRACIÓN",
        items: [
          `${p}promote`,
          `${p}demote`,
          `${p}daradmins`,
          `${p}quitaradmins`,
          `${p}kick`,
          `${p}tag`,
          `${p}tagall`,
          `${p}todos`,
          `${p}invocar`,
          `${p}totalchat`,
          `${p}restchat`,
          `${p}fantasmas`,
          `${p}fankick`,
          `${p}delete`,
          `${p}linkgrupo`,
          `${p}mute`,
          `${p}unmute`,
          `${p}ban`,
          `${p}unban`,
          `${p}restpro`,
          `${p}abrir (automático)`,
          `${p}cerrar (automático)`,
          `${p}abrirgrupo`,
          `${p}cerrargrupo`
        ]
      }
    ],
    nota: "Panel de control grupal 🛡️"
  });
};

handler.command = ["menugrupo", "grupomenu"];
export default handler;
