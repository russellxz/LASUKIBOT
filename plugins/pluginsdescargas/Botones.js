// plugins/botones.js
// Activa o desactiva el uso de botones/menús interactivos en el bot.
// El estado se guarda en ./activoss.json
// Uso:
//   .botones on   → activa botones
//   .botones off  → desactiva botones
//   .botones      → muestra el estado actual

"use strict";

import { canal } from "../../disenos.js";
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.resolve("./activoss.json");

// Valores por defecto: botones ACTIVADOS
const DEFAULT_CONFIG = {
  botones: true,
  updatedAt: null,
  updatedBy: null,
};

// Crea activoss.json si no existe (por defecto con botones activados)
function ensureConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    } catch (e) {
      console.error("[botones] no se pudo crear activoss.json:", e);
    }
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    // Si el archivo está corrupto, lo reescribimos limpio
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2)); } catch {}
    return { ...DEFAULT_CONFIG };
  }
}

// Inicializar al cargar el plugin
ensureConfig();

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;
  const pref = global.prefixes?.[0] || ".";

  // 🛡️ Permisos de owner (MISMO estilo que .carga)
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
  const isOwner = owners.some(([id]) => id === senderId);

  if (!isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: "⛔ Este comando es solo para el *Owner*."
    }, { quoted: msg });
    return;
  }

  const cfg = ensureConfig();
  const accion = (args?.[0] || "").toLowerCase().trim();

  // Sin argumentos → mostrar estado actual
  if (!accion) {
    const estado = cfg.botones ? "🟢 *ACTIVADOS*" : "🔴 *DESACTIVADOS*";
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text:
`╭━━━━━━━━━━━━━━━━━━━━╮
   ⚙️ ESTADO DE BOTONES
╰━━━━━━━━━━━━━━━━━━━━╯

📍 Estado actual: ${estado}

📋 *Uso:*
   • *${pref}botones on*  → activar
   • *${pref}botones off* → desactivar
   • *${pref}botones*     → ver estado`,
    }, { quoted: msg });
  }

  // Validar argumento
  if (!["on", "off"].includes(accion)) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `⚠️ Opción inválida.\n\nUsa:\n   • *${pref}botones on*\n   • *${pref}botones off*`,
    }, { quoted: msg });
  }

  const nuevoEstado = accion === "on";

  // Si ya está en ese estado, avisar
  if (cfg.botones === nuevoEstado) {
    const emoji = nuevoEstado ? "🟢" : "🔴";
    const txt = nuevoEstado ? "ya están *ACTIVADOS*" : "ya están *DESACTIVADOS*";
    await conn.sendMessage(chatId, { react: { text: "ℹ️", key: msg.key } });
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `${emoji} Los botones ${txt}. No se hicieron cambios.`,
    }, { quoted: msg });
  }

  // Aplicar cambio
  cfg.botones = nuevoEstado;
  cfg.updatedAt = new Date().toISOString();
  cfg.updatedBy = senderId;

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error("[botones] error guardando activoss.json:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: `❌ Error al guardar los cambios: \`${e.message}\``,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  const emoji = nuevoEstado ? "🟢" : "🔴";
  const estado = nuevoEstado ? "*ACTIVADOS*" : "*DESACTIVADOS*";
  const extra = nuevoEstado
    ? "📥 Los comandos con menús interactivos ahora mostrarán botones."
    : "📄 Los comandos mostrarán solo el texto tradicional (sin botones).";

  return conn.sendMessage(chatId, {
      contextInfo: canal(),
    text:
`╭━━━━━━━━━━━━━━━━━━━━╮
   ⚙️ BOTONES ACTUALIZADOS
╰━━━━━━━━━━━━━━━━━━━━╯

${emoji} Estado: ${estado}

${extra}

💾 Guardado en *activoss.json*`,
  }, { quoted: msg });
};

handler.command = ["botones"];
export default handler;
