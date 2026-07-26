// plugins/Allmenu.js — Lista TODOS los comandos activos del bot.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = global.prefixes?.[0] || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "🧩", key: msg.key } }, msg); } catch {}

  const comandos = [
    ...new Set(
      (global.plugins || []).flatMap((pl) => {
        const c = pl?.command;
        if (!c) return [];
        const arr = Array.isArray(c) ? c : [c];
        return arr.filter((x) => typeof x === "string");
      })
    )
  ].sort((a, b) => a.localeCompare(b));

  return enviarMenu(conn, chatId, msg, "allmenu", {
    titulo: "TODOS LOS COMANDOS",
    info: [
      ["Comandos activos", comandos.length],
      ["Prefijo actual", p]
    ],
    secciones: [
      {
        titulo: "📦 LISTA COMPLETA",
        items: comandos.map((c) => `${p}${c}`)
      }
    ],
    nota: "Bot creado desde cero 🧠"
  });
};

handler.command = ["allmenu"];
handler.help = ["allmenu"];
handler.tags = ["menu"];

export default handler;
