// plugins/trag.js
// Migra los primeros N paquetes completos del guar.json (base64) a archivos físicos
// y los elimina del guar.json viejo.
// Uso: .trag <cantidad>
//   .trag 1  → migra 1 paquete
//   .trag 5  → migra los primeros 5 paquetes

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RUTA_VIEJA = path.resolve("./guar.json");
const RUTA_NUEVA = path.resolve("./guar_files.json");
const MEDIA_ROOT = path.resolve("./guar_media");

function mimeToExt(mime, fallback = "bin") {
  if (!mime || typeof mime !== "string") return fallback;
  const base = mime.split(";")[0];
  const [, sub] = base.split("/");
  if (!sub) return fallback;
  if (sub.includes("mpeg")) return "mp3";
  if (sub.includes("webp")) return "webp";
  if (sub.includes("quicktime")) return "mov";
  if (sub.includes("x-msvideo")) return "avi";
  if (sub.includes("x-matroska")) return "mkv";
  return sub.replace(/^x-/, "") || fallback;
}

function sanitizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64) || "default";
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "🔄", key: msg.key } });

  // ====== Parsear cantidad ======
  const cantidad = parseInt(args?.[0]);
  if (isNaN(cantidad) || cantidad < 1) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❗ Uso: *${pref}trag <cantidad>*\n\nEjemplos:\n• ${pref}trag 1 → migra 1 paquete\n• ${pref}trag 5 → migra los primeros 5 paquetes\n• ${pref}trag 10 → migra los primeros 10 paquetes`,
    }, { quoted: msg });
  }

  if (!fs.existsSync(RUTA_VIEJA)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ No existe `guar.json`, no hay nada que migrar.",
    }, { quoted: msg });
  }

  // ====== Cargar guar.json viejo ======
  let dbVieja = {};
  try {
    dbVieja = JSON.parse(fs.readFileSync(RUTA_VIEJA, "utf-8"));
  } catch (e) {
    console.error("[trag] error leyendo guar.json:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al leer guar.json:\n\`${e.message}\``,
    }, { quoted: msg });
  }

  const todasLasClaves = Object.keys(dbVieja);
  if (todasLasClaves.length === 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "📂 `guar.json` está vacío, no hay paquetes que migrar.",
    }, { quoted: msg });
  }

  // Tomar los primeros N paquetes
  const clavesAMigrar = todasLasClaves.slice(0, cantidad);

  // ====== Cargar guar_files.json (destino) ======
  let dbNueva = {};
  if (fs.existsSync(RUTA_NUEVA)) {
    try { dbNueva = JSON.parse(fs.readFileSync(RUTA_NUEVA, "utf-8")); } catch { dbNueva = {}; }
  }

  // Asegurar carpeta raíz
  if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });

  // ====== Procesar cada paquete ======
  let paquetesMigrados = 0;
  let itemsMigrados = 0;
  let itemsErrores = 0;
  const detalles = [];

  for (const paquete of clavesAMigrar) {
    const items = dbVieja[paquete];
    if (!Array.isArray(items) || items.length === 0) {
      delete dbVieja[paquete];
      continue;
    }

    const safeKey = sanitizeKey(paquete);
    const keyDir = path.join(MEDIA_ROOT, safeKey);
    if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });

    let migradosEnPaquete = 0;

    for (const item of items) {
      try {
        if (!item.media) {
          itemsErrores++;
          continue;
        }

        const buf = Buffer.from(item.media, "base64");
        if (!buf.length) {
          itemsErrores++;
          continue;
        }

        const mime = item.mime || "application/octet-stream";
        const ext = item.ext || mimeToExt(mime, "bin");

        const timestamp = Date.now() + Math.floor(Math.random() * 1000);
        const randomId = crypto.randomBytes(4).toString("hex");
        const fileName = `${timestamp}_${randomId}.${ext}`;
        const filePath = path.join(keyDir, fileName);
        const relativePath = path.relative(process.cwd(), filePath).split(path.sep).join("/");

        // Escribir archivo físico
        fs.writeFileSync(filePath, buf);

        // Añadir entrada a dbNueva
        if (!Array.isArray(dbNueva[paquete])) dbNueva[paquete] = [];
        dbNueva[paquete].push({
          type: item.type,
          path: relativePath,
          fileName,
          mime,
          ext,
          size: buf.length,
          user: item.user || item.de || "",
          caption: item.caption || null,
          createdAt: timestamp,
          migratedFrom: paquete,
        });

        migradosEnPaquete++;
        itemsMigrados++;
      } catch (e) {
        console.error(`[trag] error en item de ${paquete}:`, e);
        itemsErrores++;
      }
    }

    if (migradosEnPaquete > 0) {
      paquetesMigrados++;
      detalles.push(`• *${paquete}*: ${migradosEnPaquete} archivo${migradosEnPaquete !== 1 ? "s" : ""}`);
    }

    // Eliminar el paquete del guar.json viejo (ya se migró)
    delete dbVieja[paquete];
  }

  // ====== Guardar ambos JSONs ======
  try {
    fs.writeFileSync(RUTA_NUEVA, JSON.stringify(dbNueva, null, 2));
    fs.writeFileSync(RUTA_VIEJA, JSON.stringify(dbVieja, null, 2));
  } catch (e) {
    console.error("[trag] error guardando JSONs:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al guardar los cambios:\n\`${e.message}\``,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  // ====== Armar mensaje de resultado ======
  const restantes = Object.keys(dbVieja).length;
  let texto = `✅ *Migración completada*\n\n`;
  texto += `📦 Paquetes migrados: *${paquetesMigrados}*\n`;
  texto += `📄 Archivos migrados: *${itemsMigrados}*\n`;
  if (itemsErrores > 0) texto += `⚠️ Items con error: *${itemsErrores}*\n`;
  texto += `📊 Paquetes restantes en guar.json: *${restantes}*\n\n`;

  if (detalles.length > 0) {
    // Si hay muchos paquetes, recortar para no superar límites de WhatsApp
    const maxLineas = 20;
    if (detalles.length <= maxLineas) {
      texto += `*Detalles:*\n${detalles.join("\n")}`;
    } else {
      texto += `*Detalles (primeros ${maxLineas}):*\n${detalles.slice(0, maxLineas).join("\n")}\n_...y ${detalles.length - maxLineas} más_`;
    }
  }

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["trag"];
export default handler;
