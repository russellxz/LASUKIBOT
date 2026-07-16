// plugins/menuaudio.js
// Lista los paquetes multimedia guardados en el NUEVO formato (guar_files.json + ./guar_media/)
// Soporta también el formato viejo (guar.json) por compatibilidad: si existen ambos, los combina.

import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const base = conn?.subDataDir || process.cwd();
  const FILES_DB = path.join(base, "guar_files.json");
  const OLD_DB = path.join(base, "guar.json");
  const chatId = msg.key.remoteJid;

  await conn.sendMessage2(chatId, {
    react: { text: "🎵", key: msg.key }
  }, msg);

  // ====== Cargar paquetes del NUEVO formato (guar_files.json) ======
  let guarFiles = {};
  if (fs.existsSync(FILES_DB)) {
    try {
      guarFiles = JSON.parse(fs.readFileSync(FILES_DB, "utf-8"));
    } catch (e) {
      console.error("[menuaudio] error leyendo guar_files.json:", e);
      guarFiles = {};
    }
  }

  // ====== Cargar paquetes del formato VIEJO (guar.json) por si quedó algo sin migrar ======
  let guarOld = {};
  if (fs.existsSync(OLD_DB)) {
    try {
      guarOld = JSON.parse(fs.readFileSync(OLD_DB, "utf-8"));
    } catch (e) {
      console.error("[menuaudio] error leyendo guar.json:", e);
      guarOld = {};
    }
  }

  // ====== Combinar paquetes ======
  // Cuenta cuántos archivos hay por paquete (sumando ambos formatos)
  const paquetesMap = new Map();

  // Contar nuevo formato (puede ser array o objeto único)
  for (const [clave, valor] of Object.entries(guarFiles)) {
    let cantidad = 0;
    if (Array.isArray(valor)) {
      cantidad = valor.length;
    } else if (valor && typeof valor === "object") {
      cantidad = 1;
    }
    if (cantidad > 0) {
      paquetesMap.set(clave, (paquetesMap.get(clave) || 0) + cantidad);
    }
  }

  // Contar viejo formato (puede ser objeto único o array)
  for (const [clave, valor] of Object.entries(guarOld)) {
    let cantidad = 0;
    if (Array.isArray(valor)) {
      cantidad = valor.length;
    } else if (valor && typeof valor === "object") {
      cantidad = 1;
    }
    if (cantidad > 0) {
      paquetesMap.set(clave, (paquetesMap.get(clave) || 0) + cantidad);
    }
  }

  // Ordenar alfabéticamente para que se vea bonito
  const paquetes = Array.from(paquetesMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "es", { sensitivity: "base" })
  );
  const total = paquetes.length;
  const totalArchivos = paquetes.reduce((sum, [, n]) => sum + n, 0);

  const caption = `𖠺𝑆𝑢𝑏𝑏𝑜𝑡𝑠 𝑆𝑢𝑘𝑖𖠺

𖠁🗂️ 𝙋𝘼𝙌𝙐𝙀𝙏𝙀𝙎 𝘿𝙀 𝙈𝙐𝙇𝙏𝙄𝙈𝙀𝘿𝙄𝘼𖠁
🎧 Audios, 🎞️ videos, 🖼️ imágenes, 🧩 stickers y más...

📝 *¿Cómo funciona?*
Solo escribe el *nombre del paquete* en el chat y *Suki Subbots* enviará al azar uno de los archivos guardados dentro de ese paquete.

📥 Para *guardar multimedia* responde a cualquier imagen, audio, sticker o video con:
➤ *.guar nombreDelPaquete*

🗑️ Para *borrar un archivo específico* de un paquete:
➤ *.del nombreDelPaquete número*

🔍 Para *ver un archivo específico* de un paquete:
➤ *.g nombreDelPaquete número*

📦 Todos los paquetes son públicos y compartidos entre los usuarios del grupo.

━━━━━━━━━━━━━━━

📦 *Paquetes disponibles:* ${total}
📄 *Archivos totales:* ${totalArchivos}

${
  total > 0
    ? "╭─────◆\n" +
      paquetes
        .map(([key, n]) => `│๛ ${key} [${n} archivo${n !== 1 ? "s" : ""}]`)
        .join("\n") +
      "\n╰─────◆"
    : "❌ No hay multimedia guardada aún. Usa *.guar nombre* para comenzar."
}
`.trim();

  await conn.sendMessage2(chatId, {
    image: { url: "https://cdn.russellxz.click/c678c800.jpg" },
    caption
  }, msg);
};

handler.command = ["menuaudio"];
handler.help = ["menuaudio"];
handler.tags = ["menu"];
handler.register = true;

export default handler;
