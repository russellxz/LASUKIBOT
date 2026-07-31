// plugins/pluginsgrupos/Menugrupo.js — Menú de grupos.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "💠", key: msg.key } }, msg); } catch {}

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
          `${p}antiporno on/off`,
          `${p}antigore on/off`,
          `${p}antispam on/off`,
          `${p}warn @user <motivo>`,
          `${p}unwarn @user`,
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
handler.help = ["menugrupo"];
handler.tags = ["menu"];

export default handler;
