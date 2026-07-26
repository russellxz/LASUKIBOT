// subplugins/varios/Allmenu.js — Lista TODOS los comandos del subbot.
// El diseño, la imagen/video y el nombre salen de la personalización del
// propio subbot (comando setmenu).
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p =
    (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) ||
    global.prefixes?.[0] ||
    ".";

  try { await conn.sendMessage(chatId, { react: { text: "🧩", key: msg.key } }); } catch {}

  // Comandos del subbot (antes listaba por error los del bot principal)
  const comandos = [
    ...new Set(
      (global.subPlugins || []).flatMap((pl) => {
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
    nota: "Gracias por usarme 💖"
  });
};

handler.command = ["allmenu"];
export default handler;
