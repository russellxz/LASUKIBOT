// plugins/pluginsgrupos/Menuaudio.js — Paquetes multimedia guardados.
// Lee el formato nuevo (guar_files.json + ./guar_media/) y el viejo (guar.json).
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import fs from 'fs';
import path from 'path';
import { enviarMenu, getMarca } from "../../disenos.js";

const FILES_DB = path.resolve("./guar_files.json");
const OLD_DB = path.resolve("./guar.json");

function leerDB(file, etiqueta) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`[menuaudio] error leyendo ${etiqueta}:`, e);
    return {};
  }
}

function contar(mapa, datos) {
  for (const [clave, valor] of Object.entries(datos)) {
    let cantidad = 0;
    if (Array.isArray(valor)) cantidad = valor.length;
    else if (valor && typeof valor === "object") cantidad = 1;
    if (cantidad > 0) mapa.set(clave, (mapa.get(clave) || 0) + cantidad);
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "🎵", key: msg.key } }, msg); } catch {}

  const paquetesMap = new Map();
  contar(paquetesMap, leerDB(FILES_DB, "guar_files.json"));
  contar(paquetesMap, leerDB(OLD_DB, "guar.json"));

  const paquetes = Array.from(paquetesMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "es", { sensitivity: "base" })
  );
  const total = paquetes.length;
  const totalArchivos = paquetes.reduce((sum, [, n]) => sum + n, 0);

  const secciones = [
    {
      titulo: "📝 CÓMO FUNCIONA",
      items: [
        `Escribe el *nombre del paquete* y ${getMarca(conn)} enviará al azar uno de sus archivos`,
        `${p}guar <nombre> — guardar (responde a la media)`,
        `${p}del <nombre> <número> — borrar un archivo`,
        `${p}g <nombre> <número> — ver un archivo`
      ]
    }
  ];

  if (total > 0) {
    secciones.push({
      titulo: "📦 PAQUETES DISPONIBLES",
      items: paquetes.map(([key, n]) => `${key} [${n} archivo${n !== 1 ? "s" : ""}]`)
    });
  }

  return enviarMenu(conn, chatId, msg, "menuaudio", {
    titulo: "PAQUETES DE MULTIMEDIA",
    info: [
      ["Paquetes disponibles", total],
      ["Archivos totales", totalArchivos]
    ],
    secciones,
    nota:
      total > 0
        ? "Los paquetes son públicos y compartidos entre los usuarios del grupo 🎧"
        : `Todavía no hay multimedia guardada. Usa *${p}guar nombre* para empezar.`
  });
};

handler.command = ["menuaudio"];
handler.help = ["menuaudio"];
handler.tags = ["menu"];
handler.register = true;

export default handler;
