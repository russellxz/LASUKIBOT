// plugins/mododiablo.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const XP_PERSONAJE_BASE = 150;
const XP_HAB_BASE = 80;
const CREDITOS_MIN = 250;
const CREDITOS_MAX = 400;
const XP_MIN = 450;
const XP_MAX = 600;

// Límites diarios
const LIMITE_CREDITOS_DIA = 9000;
const LIMITE_XP_DIA = 10000;

const TEXTOS_MODODIABLO = [
  "😈 {nombre} desató el *Modo Diablo* con *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🔥 {nombre} invocó su forma demoníaca junto a *{personaje}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "💀 {nombre} sembró el caos en *Modo Diablo* con *{personaje}* y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🌑 {nombre} dominó las tinieblas con *{personaje}* y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🩸 {nombre} liberó todo su poder infernal con *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP."
];

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "😈", key: msg.key } });

  const filePath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  if (!Array.isArray(usuario.personajes) || usuario.personajes.length === 0) {
    return conn.sendMessage(chatId, { text: "🎭 No tienes un personaje activo. Compra uno en la tienda." }, { quoted: msg });
  }

  const ahora = Date.now();
  if (usuario.ultimoMododiablo && (ahora - usuario.ultimoMododiablo) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoMododiablo)) / 1000);
    const min = Math.floor(falta / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${min}m ${seg}s* para volver a usar el Modo Diablo.` }, { quoted: msg });
  }
  usuario.ultimoMododiablo = ahora;

  // === LÍMITE DIARIO ===
  const hoy = new Date().toDateString();
  usuario.limites = usuario.limites || {};
  usuario.limites.mododiablo = usuario.limites.mododiablo || { fecha: hoy, creditosHoy: 0, xpHoy: 0 };
  if (usuario.limites.mododiablo.fecha !== hoy) {
    usuario.limites.mododiablo = { fecha: hoy, creditosHoy: 0, xpHoy: 0 };
  }
  const track = usuario.limites.mododiablo;
  const restanteCred = Math.max(0, LIMITE_CREDITOS_DIA - track.creditosHoy);
  const restanteXP = Math.max(0, LIMITE_XP_DIA - track.xpHoy);
  if (restanteCred <= 0 && restanteXP <= 0) {
    return conn.sendMessage(chatId, { text: "🛑 Has alcanzado el límite diario de *mododiablo* (9 000 créditos y 10 000 XP). Inténtalo mañana." }, { quoted: msg });
  }

  const personaje = usuario.personajes[0];
  personaje.nivel = personaje.nivel || 1;
  personaje.xp = personaje.xp || 0;
  personaje.habilidades = Array.isArray(personaje.habilidades) && personaje.habilidades.length >= 2
    ? personaje.habilidades
    : [
        { nombre: "Habilidad 1", nivel: 1, xp: 0 },
        { nombre: "Habilidad 2", nivel: 1, xp: 0 }
      ];
  for (const h of personaje.habilidades) { h.nivel = h.nivel || 1; h.xp = h.xp || 0; }

  // Recompensas
  let creditosGanados = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  let xpGanada = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  // Aplicar límite
  creditosGanados = Math.min(creditosGanados, restanteCred);
  xpGanada = Math.min(xpGanada, restanteXP);
  if (creditosGanados <= 0 && xpGanada <= 0) {
    return conn.sendMessage(chatId, { text: "🛑 Con esta acción superarías el límite diario de *mododiablo*. Vuelve mañana." }, { quoted: msg });
  }

  // Aplicar y trackear
  usuario.creditos = (usuario.creditos || 0) + creditosGanados;
  track.creditosHoy += creditosGanados;
  track.xpHoy += xpGanada;

  // Subida de nivel personaje
  let subioNivelPersonaje = false;
  personaje.xp += xpGanada;
  let xpNecesaria = XP_PERSONAJE_BASE + (personaje.nivel * 25);
  while (personaje.xp >= xpNecesaria) {
    personaje.xp -= xpNecesaria;
    personaje.nivel++;
    subioNivelPersonaje = true;
    xpNecesaria = XP_PERSONAJE_BASE + (personaje.nivel * 25);
  }

  // Subida de habilidad aleatoria
  const idxHab = Math.random() < 0.5 ? 0 : 1;
  const hab = personaje.habilidades[idxHab];
  let habilidadSubida = null;
  if (hab.nivel < 100 && xpGanada > 0) {
    hab.xp += xpGanada;
    let xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    while (hab.xp >= xpNecesariaHab && hab.nivel < 100) {
      hab.xp -= xpNecesariaHab;
      hab.nivel++;
      habilidadSubida = `${hab.nombre} (Nv ${hab.nivel})`;
      xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));

  const base = TEXTOS_MODODIABLO[Math.floor(Math.random() * TEXTOS_MODODIABLO.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`.trim())
    .replace("{personaje}", personaje.nombre || "tu personaje")
    .replace("{creditos}", creditosGanados)
    .replace("{xp}", xpGanada);

  let mensajeFinal = base;
  if (subioNivelPersonaje) mensajeFinal += `\n\n🎉 *¡${personaje.nombre || "Tu personaje"} subió a nivel ${personaje.nivel}!*`;
  if (habilidadSubida) mensajeFinal += `\n\n✨ *Habilidad de personaje mejorada:* ${habilidadSubida}`;

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["mododiablo"];
export default handler;
