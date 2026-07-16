// plugins/trag2.js
// Convierte un guar.json con estructura DIFERENTE (de otro bot) en archivos físicos
// compatibles con el sistema actual de Suki (guar_files.json + guar_media/).
//
// 📦 Estructura ORIGINAL del archivo a migrar (otro bot):
// {
//   "palabra_clave": {
//     "buffer": "<base64>",
//     "mimetype": "image/jpeg",
//     "extension": "jpg",
//     "savedBy": "521234567890@s.whatsapp.net"
//   }
// }
//
// ✅ Resultado: lo convierte al formato compatible con Suki:
// - Crea archivo físico en ./guar_media/<palabra>/<timestamp>_<rand>.<ext>
// - Añade entrada en ./guar_files.json con la ruta del archivo
//
// 📂 Lee desde: ./guar2.json   (puedes subir el archivo del otro bot ahí)
// 📂 Escribe a: ./guar_files.json  (mismo que usa Suki)
// 📂 Archivos: ./guar_media/<palabra>/...
//
// Uso:
//   .trag2 <cantidad>      → migra N paquetes del guar2.json
//   .trag2 all             → migra TODOS los paquetes
//   .trag2 1               → migra el primer paquete
//   .trag2 5               → migra los primeros 5

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// 📂 Rutas
import { guarPaths } from './_guarpaths.js';

function mimeToExt(mime, fallback = "bin") {
  if (!mime || typeof mime !== "string") return fallback;
  const base = mime.split(";")[0];
  const [tipo, sub] = base.split("/");
  if (!sub) return fallback;
  if (sub.includes("mpeg")) return "mp3";
  if (sub.includes("webp")) return "webp";
  if (sub.includes("quicktime")) return "mov";
  if (sub.includes("x-msvideo")) return "avi";
  if (sub.includes("x-matroska")) return "mkv";
  if (sub.includes("ogg")) return "ogg";
  return sub.replace(/^x-/, "") || fallback;
}

function mimeToType(mime) {
  if (!mime || typeof mime !== "string") return "document";
  const base = mime.split(";")[0].toLowerCase();
  if (base.startsWith("image/webp")) return "sticker";
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "document";
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
  const { guar2Json: RUTA_VIEJA, filesDb: RUTA_NUEVA, mediaRoot: MEDIA_ROOT } = guarPaths(conn);
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "🔄", key: msg.key } });

  // ====== Validar argumento ======
  const argRaw = String(args?.[0] || "").toLowerCase().trim();
  let cantidad = 0;
  let migrarTodo = false;

  if (argRaw === "all" || argRaw === "todo" || argRaw === "todos") {
    migrarTodo = true;
  } else {
    cantidad = parseInt(argRaw);
    if (isNaN(cantidad) || cantidad < 1) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, {
        text:
`❗ *Uso:* \`${pref}trag2 <cantidad|all>\`

📂 Lee desde: \`./guar2.json\`
📂 Convierte a: \`./guar_files.json\` + \`./guar_media/\`

*Ejemplos:*
• \`${pref}trag2 1\` → migra 1 paquete
• \`${pref}trag2 5\` → migra los primeros 5
• \`${pref}trag2 all\` → migra TODO

⚠️ Asegúrate de subir el archivo \`guar.json\` del otro bot como \`guar2.json\` en la raíz.`
      }, { quoted: msg });
    }
  }

  // ====== Verificar archivo origen ======
  if (!fs.existsSync(RUTA_VIEJA)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text:
`⚠️ No encontré \`guar2.json\` en la raíz del bot.

📌 Para usar este comando:
1. Sube el \`guar.json\` del otro bot.
2. Renómbralo a \`guar2.json\`.
3. Colócalo en la raíz del bot (donde está \`index.js\`).
4. Usa \`${pref}trag2 <cantidad|all>\``
    }, { quoted: msg });
  }

  // ====== Cargar guar2.json (estructura diferente) ======
  let dbVieja = {};
  try {
    const raw = fs.readFileSync(RUTA_VIEJA, "utf-8");
    dbVieja = JSON.parse(raw);
  } catch (e) {
    console.error("[trag2] error leyendo guar2.json:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ *Error al leer guar2.json:*\n\`${e.message}\``
    }, { quoted: msg });
  }

  if (!dbVieja || typeof dbVieja !== "object" || Array.isArray(dbVieja)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "❌ El archivo `guar2.json` no tiene formato de objeto válido."
    }, { quoted: msg });
  }

  const todasLasClaves = Object.keys(dbVieja);
  if (todasLasClaves.length === 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "📂 `guar2.json` está vacío, no hay paquetes que migrar."
    }, { quoted: msg });
  }

  // Decidir cuántos migrar
  const clavesAMigrar = migrarTodo ? todasLasClaves : todasLasClaves.slice(0, cantidad);

  // ====== Cargar guar_files.json (destino de Suki) ======
  let dbNueva = {};
  if (fs.existsSync(RUTA_NUEVA)) {
    try {
      dbNueva = JSON.parse(fs.readFileSync(RUTA_NUEVA, "utf-8"));
    } catch (e) {
      console.error("[trag2] guar_files.json corrupto, se reinicia:", e);
      dbNueva = {};
    }
  }

  // Asegurar carpeta raíz
  if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });

  // ====== Procesar cada paquete ======
  let paquetesMigrados = 0;
  let paquetesYaExistian = 0;
  let itemsMigrados = 0;
  let itemsErrores = 0;
  const detalles = [];

  for (const paquete of clavesAMigrar) {
    const item = dbVieja[paquete];

    // Validar estructura del paquete (otro bot guarda objeto único, no array)
    if (!item || typeof item !== "object") {
      console.log(`[trag2] paquete "${paquete}" inválido, se omite`);
      delete dbVieja[paquete];
      continue;
    }

    // Soporte: si vino como array (raro), tomar el primer elemento
    let entry = Array.isArray(item) ? item[0] : item;
    if (!entry || typeof entry !== "object") {
      delete dbVieja[paquete];
      continue;
    }

    // Verificar campo de base64 (puede venir como buffer, media o data)
    const base64Data = entry.buffer || entry.media || entry.data || null;
    if (!base64Data || typeof base64Data !== "string") {
      console.log(`[trag2] paquete "${paquete}" sin buffer base64, se omite`);
      itemsErrores++;
      delete dbVieja[paquete];
      continue;
    }

    try {
      // Decodificar base64
      const buf = Buffer.from(base64Data, "base64");
      if (!buf.length) {
        console.log(`[trag2] paquete "${paquete}" buffer vacío`);
        itemsErrores++;
        delete dbVieja[paquete];
        continue;
      }

      // Derivar mimetype, extension y type
      const mime = entry.mimetype || entry.mime || "application/octet-stream";
      const ext = (entry.extension || entry.ext || mimeToExt(mime, "bin")).toLowerCase();
      const tipo = entry.type || mimeToType(mime);

      // Crear carpeta de la palabra clave
      const safeKey = sanitizeKey(paquete);
      const keyDir = path.join(MEDIA_ROOT, safeKey);
      if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });

      // Nombre único
      const timestamp = Date.now() + Math.floor(Math.random() * 10000);
      const randomId = crypto.randomBytes(4).toString("hex");
      const fileName = `${timestamp}_${randomId}.${ext}`;
      const filePath = path.join(keyDir, fileName);
      const relativePath = path
        .relative(process.cwd(), filePath)
        .split(path.sep)
        .join("/");

      // Escribir archivo físico
      fs.writeFileSync(filePath, buf);

      // Limpiar usuario (solo dígitos)
      const userClean = String(entry.savedBy || entry.user || entry.de || "")
        .replace(/[^0-9]/g, "");

      // Crear entrada compatible con Suki
      const newEntry = {
        type: tipo,
        path: relativePath,
        fileName,
        mime,
        ext,
        size: buf.length,
        user: userClean,
        caption: entry.caption || null,
        createdAt: timestamp,
        migratedFrom: "guar2.json"
      };

      // Si la palabra clave ya existía en Suki, se añade al array (no se sobreescribe)
      if (Array.isArray(dbNueva[paquete])) {
        dbNueva[paquete].push(newEntry);
        paquetesYaExistian++;
      } else {
        dbNueva[paquete] = [newEntry];
        paquetesMigrados++;
      }

      itemsMigrados++;
      detalles.push(`• *${paquete}* → ${tipo} (${ext}, ${(buf.length / 1024).toFixed(1)} KB)`);

      // Eliminar paquete del guar2.json viejo
      delete dbVieja[paquete];
    } catch (e) {
      console.error(`[trag2] error migrando "${paquete}":`, e);
      itemsErrores++;
    }
  }

  // ====== Guardar JSONs ======
  try {
    fs.writeFileSync(RUTA_NUEVA, JSON.stringify(dbNueva, null, 2));
    fs.writeFileSync(RUTA_VIEJA, JSON.stringify(dbVieja, null, 2));
  } catch (e) {
    console.error("[trag2] error guardando JSONs:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ *Error al guardar los JSONs:*\n\`${e.message}\``
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  // ====== Mensaje de resultado ======
  const restantes = Object.keys(dbVieja).length;
  let texto = `✅ *Migración trag2 completada*\n\n`;
  texto += `📦 Paquetes nuevos en Suki: *${paquetesMigrados}*\n`;
  if (paquetesYaExistian > 0) {
    texto += `🔁 Paquetes añadidos a existentes: *${paquetesYaExistian}*\n`;
  }
  texto += `📄 Archivos físicos creados: *${itemsMigrados}*\n`;
  if (itemsErrores > 0) texto += `⚠️ Items con error: *${itemsErrores}*\n`;
  texto += `📊 Restantes en guar2.json: *${restantes}*\n\n`;

  if (detalles.length > 0) {
    const maxLineas = 18;
    if (detalles.length <= maxLineas) {
      texto += `*Detalles:*\n${detalles.join("\n")}`;
    } else {
      texto += `*Detalles (primeros ${maxLineas}):*\n${detalles.slice(0, maxLineas).join("\n")}\n_...y ${detalles.length - maxLineas} más_`;
    }
  }

  return conn.sendMessage(chatId, { text: texto }, { quoted: msg });
};

handler.command = ["trag2"];
export default handler;
