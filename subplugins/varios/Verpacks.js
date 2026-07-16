import fs from 'fs';
import path from 'path';

const RUTA_VIEJA = path.resolve("./guar.json");       // legacy (base64)
const RUTA_NUEVA = path.resolve("./guar_files.json"); // nuevo (rutas)

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  await conn.sendMessage(chatId, {
    react: { text: "📦", key: msg.key }
  });

  // ====== Cargar ambas bases de datos ======
  let dbVieja = {};
  let dbNueva = {};

  if (fs.existsSync(RUTA_VIEJA)) {
    try { dbVieja = JSON.parse(fs.readFileSync(RUTA_VIEJA, "utf-8")); } catch { dbVieja = {}; }
  }
  if (fs.existsSync(RUTA_NUEVA)) {
    try { dbNueva = JSON.parse(fs.readFileSync(RUTA_NUEVA, "utf-8")); } catch { dbNueva = {}; }
  }

  // ====== Limpiar paquetes vacíos en ambos ======
  let cambiosVieja = false, cambiosNueva = false;
  for (const key in dbVieja) {
    if (!Array.isArray(dbVieja[key]) || dbVieja[key].length === 0) {
      delete dbVieja[key];
      cambiosVieja = true;
    }
  }
  for (const key in dbNueva) {
    if (!Array.isArray(dbNueva[key]) || dbNueva[key].length === 0) {
      delete dbNueva[key];
      cambiosNueva = true;
    }
  }
  if (cambiosVieja && fs.existsSync(RUTA_VIEJA)) {
    try { fs.writeFileSync(RUTA_VIEJA, JSON.stringify(dbVieja, null, 2)); } catch {}
  }
  if (cambiosNueva && fs.existsSync(RUTA_NUEVA)) {
    try { fs.writeFileSync(RUTA_NUEVA, JSON.stringify(dbNueva, null, 2)); } catch {}
  }

  // ====== Combinar las claves de ambas DBs ======
  // Los viejos van primero, los nuevos después (mismo orden que usa .del)
  const todasLasClaves = new Set([...Object.keys(dbVieja), ...Object.keys(dbNueva)]);

  if (todasLasClaves.size === 0) {
    return conn.sendMessage(chatId, {
      text: "📂 *Lista vacía:* No hay paquetes con contenido."
    }, { quoted: msg });
  }

  // ====== Función auxiliar para determinar el tipo del archivo ======
  const detectarTipo = (item) => {
    const ext = item.ext?.toLowerCase() || "";
    const mime = item.mime?.toLowerCase() || "";

    if (ext === "webp") return "🖼 Sticker";
    if (mime === "audio/ogg" || mime === "audio/opus") return "🎙 Nota de Voz";
    if (mime.startsWith("audio/")) return "🎵 Audio";
    if (mime.startsWith("video/")) return "🎥 Video";
    if (mime.startsWith("image/")) return "🖼 Imagen";
    if (mime.startsWith("application/")) return "📄 Documento";
    return "🗂 Desconocido";
  };

  // ====== Armar el texto de la lista ======
  let texto = "🎒 *Lista de paquetes guardados:*\n\n";
  const mentions = [];

  // Ordenar claves alfabéticamente para que sea más limpio
  const clavesOrdenadas = [...todasLasClaves].sort();

  for (const key of clavesOrdenadas) {
    const itemsViejos = Array.isArray(dbVieja[key]) ? dbVieja[key] : [];
    const itemsNuevos = Array.isArray(dbNueva[key]) ? dbNueva[key] : [];
    // Combinar: viejos primero, luego nuevos (igual que en .del)
    const items = [...itemsViejos, ...itemsNuevos];

    if (items.length === 0) continue;

    texto += `📁 *${key}* (${items.length} archivo${items.length !== 1 ? "s" : ""}):\n`;

    items.forEach((item, i) => {
      // Retrocompatibilidad: viejo usa "de", nuevo usa "user"
      const userId = item.user || item.de;
      const num = userId ? String(userId).replace(/[^0-9]/g, "") : null;
      const jid = num ? `${num}@s.whatsapp.net` : null;
      if (jid && !mentions.includes(jid)) mentions.push(jid);

      const tipo = detectarTipo(item);
      texto += `   ${i + 1}. ${tipo} — Guardado por: ${jid ? `@${num}` : "🤷‍♂️ Desconocido"}\n`;
    });

    texto += "\n";
  }

  return conn.sendMessage(chatId, {
    text: texto.trim(),
    mentions
  }, { quoted: msg });
};

handler.command = ["verpacks"];
export default handler;
