// subplugins/menu.js — Menú general del subbot.
// El diseño, la imagen/video y el nombre salen de la personalización del
// propio subbot (comando setmenu). Aquí solo va la lista de comandos.
import { enviarMenu } from "../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) || ".";

  try { await conn.sendMessage(chatId, { react: { text: "✨", key: msg.key } }); } catch {}

  return enviarMenu(conn, chatId, msg, "menu", {
    titulo: "MENÚ GENERAL",
    info: [
      ["Prefijo actual", p],
      ["Úsalo", "en cada comando"]
    ],
    secciones: [
      {
        titulo: "INFORMACIÓN",
        items: [`${p}ping`, `${p}speedtest`, `${p}creador`, `${p}bots`]
      },
      {
        titulo: "MENÚS DISPONIBLES",
        items: [
          `${p}menugrupo`,
          `${p}menuaudio`,
          `${p}menurpg`,
          `${p}menufree`,
          `${p}menuowner`,
          `${p}allmenu`
        ]
      },
      {
        titulo: "SUBBOT",
        items: [
          `${p}code +número`,
          `${p}addgrupo / delgrupo`,
          `${p}addlista / dellista`,
          `${p}setprefix`,
          `${p}reprefix`,
          `${p}setmenu / delmenu`,
          `${p}antideletepri on/off`
        ]
      },
      {
        titulo: "IA · CHAT BOT",
        items: [
          `${p}gemini`,
          `${p}chatgpt`,
          `${p}dalle`,
          `${p}vision / vision2`,
          `${p}chat on/off`,
          `${p}luminai`
        ]
      },
      {
        titulo: "DESCARGAS",
        items: [
          `${p}play / play2`,
          `${p}ytmp3 / ytmp4`,
          `${p}tiktok / fb / ig / spotify`,
          `${p}mediafire / apk`,
          `${p}x / twitter / tw`
        ]
      },
      {
        titulo: "BUSCADORES",
        items: [`${p}pixai`, `${p}tiktoksearch`, `${p}yts`, `${p}tiktokstalk`]
      },
      {
        titulo: "CONVERTIDORES",
        items: [
          `${p}tomp3 / toaudio`,
          `${p}hd / tts`,
          `${p}tovideo / toimg`,
          `${p}gifvideo / ff / ff2`
        ]
      },
      {
        titulo: "STICKERS",
        items: [
          `${p}s / qc / qc2 / texto`,
          `${p}mixemoji / aniemoji`,
          `${p}sks / guarsk`,
          `${p}versk / sendsk`
        ]
      },
      {
        titulo: "HERRAMIENTAS",
        items: [`${p}ver / perfil / get`, `${p}tourl / whatmusic`]
      },
      {
        titulo: "MINI JUEGOS",
        items: [
          `${p}verdad / reto`,
          `${p}personalidad`,
          `${p}parejas / ship`,
          `${p}kiss / topkiss`,
          `${p}slap / topslap`,
          `${p}menurpg`
        ]
      }
    ],
    nota: "Gracias por usarme. Eres adorable 💖"
  });
};

handler.command = ["menu", "menú", "help"];
export default handler;
