// plugins/clansupremo.js
// Uso: .clansupremo <Nombre del Clan> <nivelMinParaUnirse>
// Solo owners (según global.isOwner / fromMe / botID).
// No cobra. Crea el clan "supremo" (único) con banner especial y líder "La Suki Bot".

import fs from 'fs';
import path from 'path';

const SUPREMO_BANNER_URL = "https://cdn.russellxz.click/e1749448.jpeg";

function loadDB(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; }
function saveDB(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2)); }

function isOwnerNumber(numero, conn) {
  try {
    if (typeof global.isOwner === "function") {
      return !!global.isOwner(numero);
    }
  } catch {}
  // Fallback por si no hay global.isOwner, usar global.owner = [[num], ...]
  try {
    if (Array.isArray(global.owner)) {
      return global.owner.some(([n]) => String(n) === String(numero));
    }
  } catch {}
  // Permitir también si el mensaje es del propio bot o fromMe
  const botID = (conn.user?.id || "").replace(/\D/g, "");
  return String(numero) === String(botID);
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = !!msg.key.fromMe;

  // === Chequeo de owner igual que en addowner ===
  if (!isOwnerNumber(numero, conn) && !fromMe) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando.",
      quoted: msg
    });
  }

  if (!args?.length || args.length < 2) {
    return conn.sendMessage(chatId, {
      text: "✳️ Uso: *.clansupremo <Nombre del Clan> <nivelMinParaUnirse>*\nEj: *.clansupremo Mega flow 20*",
      quoted: msg
    });
  }

  // nivelMin = último argumento; nombre = resto
  const maybeLevel = parseInt(args[args.length - 1], 10);
  const nivelMin = Number.isFinite(maybeLevel) ? maybeLevel : null;
  const nombre = (nivelMin === null ? args.join(" ") : args.slice(0, -1).join(" ")).trim();

  if (!nombre) {
    return conn.sendMessage(chatId, { text: "❌ Debes indicar el nombre del clan.", quoted: msg });
  }
  if (!Number.isFinite(nivelMin) || nivelMin < 1) {
    return conn.sendMessage(chatId, { text: "❌ Nivel mínimo para unirse inválido (usa un número ≥ 1).", quoted: msg });
  }

  const file = path.join(process.cwd(), "sukirpg.json");
  const db = loadDB(file);
  db.clanes = Array.isArray(db.clanes) ? db.clanes : [];

  // 🚫 Solo 1 clan supremo permitido
  const yaHaySupremo = db.clanes.find(c => c.esSupremo);
  if (yaHaySupremo) {
    return conn.sendMessage(chatId, {
      text: `🚫 Ya existe un clan supremo: *${yaHaySupremo.nombre}*\n📆 Creado el: ${new Date(yaHaySupremo.creadoEn).toLocaleString()}`,
      quoted: msg
    });
  }

  // 🚫 Nombre repetido
  const existeNombre = db.clanes.find(c => (c.nombre || "").toLowerCase() === nombre.toLowerCase());
  if (existeNombre) {
    return conn.sendMessage(chatId, { text: "🚫 Ya existe un clan con ese nombre. Elige otro.", quoted: msg });
  }

  const ahora = Date.now();

  const clan = {
    id: `CLAN_${ahora}_${Math.floor(Math.random() * 9999)}`,
    nombre,
    esSupremo: true,
    bannerUrl: SUPREMO_BANNER_URL,
    creadoEn: ahora,
    nivelClan: 200, // nivel inicial para el supremo
    minNivelParaUnirse: nivelMin,
    bodegaCreditos: 0,
    // Sin líder humano: lo representa la Suki Bot
    lider: {
      numero: "BOT",
      nombre: "La Suki Bot",
      apellido: "",
      nivel: 999
    },
    origenChat: chatId,
    miembros: [] // sin integrantes al inicio
  };

  db.clanes.push(clan);
  saveDB(file, db);

  // Enviar como imagen si hay banner
  const caption =
`✅ *Clan supremo creado*
🏷️ Nombre: *${clan.nombre}*
👑 Líder: La Suki Bot
🎚️ Nivel del clan: ${clan.nivelClan}
🧰 Bodega: 0 créditos
🎯 Nivel mínimo para unirse: *${nivelMin}*
🗓️ Creado: ${new Date(ahora).toLocaleString()}

📌 Este clan guarda su banner especial para *.miclan*.`;

  if (clan.bannerUrl) {
    try {
      await conn.sendMessage(chatId, {
        image: { url: clan.bannerUrl },
        caption,
        quoted: msg
      });
      return;
    } catch {}
  }
  await conn.sendMessage(chatId, { text: caption, quoted: msg });
};

handler.command = ["clansupremo"];
export default handler;
