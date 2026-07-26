// subplugins/pluginsrpg/Menurpg.js — Menú del sistema RPG del subbot.
// El diseño, la imagen/video y el nombre salen de la personalización del
// propio subbot (comando setmenu).
import { enviarMenu } from "../../disenos.js";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  // Prefijo propio del subbot (antes usaba el del bot principal)
  const p =
    (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) ||
    global?.prefixes?.[0] ||
    ".";

  try { await conn.sendMessage(chatId, { react: { text: "✨", key: msg.key } }); } catch {}

  await enviarMenu(conn, chatId, msg, "menurpg", {
    titulo: "MENÚ RPG",
    info: [
      ["Prefijo actual", p],
      ["Úsalo", "antes de cada comando"]
    ],
    secciones: [
      {
        titulo: "🧙 PERFIL",
        items: [
          `${p}rpg <Nombre Apellido Edad Fecha> — registrarte`,
          `${p}nivel — ver tu progreso`,
          `${p}nivelper — ver tu personaje principal`,
          `${p}verper / ${p}verpersonajes — ver tus personajes`,
          `${p}vermascotas / ${p}vermas — ver tus mascotas`,
          `${p}saldo — ver tu saldo`
        ]
      },
      {
        titulo: "⚔️ PERSONAJE",
        items: [
          `${p}luchar`,
          `${p}volar`,
          `${p}enemigos`,
          `${p}otromundo`,
          `${p}otrouniverso`,
          `${p}mododios`,
          `${p}mododiablo`,
          `${p}superpoder`,
          `${p}poder`,
          `${p}podermaximo`
        ]
      },
      {
        titulo: "🐾 MASCOTAS",
        items: [
          `${p}daragua`,
          `${p}darcomida`,
          `${p}darcariño`,
          `${p}entrenar`,
          `${p}cazar`,
          `${p}pasear`,
          `${p}presumir`,
          `${p}supermascota`,
          `${p}batallamascota / ${p}batallamas — retar`,
          `${p}gomascota / ${p}gomas — aceptar`
        ]
      },
      {
        titulo: "🎌 BATALLA ANIME",
        items: [
          `${p}batallaanime / ${p}batallaani — retar (menciona o cita)`,
          `${p}goani / ${p}goper — aceptar y pelear`
        ]
      },
      {
        titulo: "🥊 BATALLA DE USUARIOS",
        items: [`${p}batallauser — retar`, `${p}gouser — aceptar y pelear`]
      },
      {
        titulo: "💼 COMANDOS DE USUARIO",
        items: [
          `${p}minar`,
          `${p}work`,
          `${p}picar`,
          `${p}correr`,
          `${p}estudiar`,
          `${p}claim`,
          `${p}cofre`,
          `${p}talar`,
          `${p}cocinar`,
          `${p}robar`
        ]
      },
      {
        titulo: "🛒 TIENDAS & BANCO",
        items: [
          `${p}tiendaper — tienda de personajes`,
          `${p}tiendamascotas — tienda de mascotas`,
          `${p}comprar — comprar personaje`,
          `${p}comprarmas — comprar mascota`,
          `${p}banco — ver/usar banco`,
          `${p}tiendabank — ver opciones del banco`,
          `${p}comprarbank — comprar/contratar en el banco`
        ]
      }
    ],
    nota: "Disfruta el mundo RPG. ¡Suerte, héroe! ⚔️"
  });

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

handler.command = ["menurpg", "menuRPG"];
export default handler;
