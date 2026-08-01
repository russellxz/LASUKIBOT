// plugins/pluginsgrupos/Menu.js — Menú general.
// El diseño, la imagen/video y el nombre salen de la personalización
// (comando setmenu). Aquí solo va la lista de comandos.
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "✨", key: msg.key } }, msg); } catch {}

  return enviarMenu(conn, chatId, msg, "menu", {
    titulo: "MENÚ GENERAL",
    info: [
      ["Prefijo actual", p],
      ["Úsalo", "en cada comando"]
    ],
    secciones: [
      {
        titulo: "INFORMACIÓN",
        items: [`${p}ping`, `${p}speedtest`, `${p}creador`, `${p}info`]
      },
      {
        titulo: "MENÚS DISPONIBLES",
        items: [
          `${p}menugrupo`,
          `${p}menuaudio`,
          `${p}menurpg`,
          `${p}menuowner`,
          `${p}menufree`,
          `${p}menuventas`
        ]
      },
      {
        titulo: "PARA VENTAS",
        items: [
          `${p}menuventas — TODOS los comandos de ventas`,
          `${p}setstock / stock`,
          `${p}setnetflix / netflix`,
          `${p}setpago / pago`,
          `${p}setcombos / combos`,
          `${p}setpeliculas / peliculas`,
          `${p}settramites / tramites`,
          `${p}setcanvas / canvas`,
          `${p}setreglas / reglas`,
          `${p}sorteo`,
          `${p}setsoporte / soporte`,
          `${p}setpromo / promo`,
          `${p}addfactura`,
          `${p}delfactura`,
          `${p}facpaga`,
          `${p}verfac`
        ]
      },
      {
        titulo: "IA · CHAT BOT",
        items: [
          `${p}gemini`,
          `${p}chatgpt`,
          `${p}dalle`,
          `${p}visión`,
          `${p}visión2`,
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
          `${p}xnxx`,
          `${p}porn`,
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
          `${p}tomp3`,
          `${p}toaudio`,
          `${p}hd`,
          `${p}tts`,
          `${p}tovideo / toimg`,
          `${p}gifvideo / ff / ff2`
        ]
      },
      {
        titulo: "STICKERS",
        items: [
          `${p}s / qc / qc2 / texto`,
          `${p}mixemoji / aniemoji`,
          `${p}addco / delco`,
          `${p}sks`,
          `${p}guarsk`,
          `${p}versk`,
          `${p}sendsk`
        ]
      },
      {
        titulo: "HERRAMIENTAS",
        items: [`${p}ver / perfil / get / xxx`, `${p}tourl / whatmusic`]
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

handler.command = ["menu"];
handler.help = ["menu"];
handler.tags = ["menu"];

export default handler;
