// plugins/otromundo.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const XP_PERSONAJE_BASE = 150;
const XP_HAB_BASE = 80;
const CREDITOS_MIN = 250;
const CREDITOS_MAX = 400;
const XP_MIN = 450;
const XP_MAX = 600;

const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const TEXTOS_OTROMUNDO = [
  "🌌 {nombre} viajó a otro mundo con *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🚀 {nombre} exploró una dimensión lejana con *{personaje}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🪐 {nombre} aterrizó en un planeta desconocido junto a *{personaje}* y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🔮 {nombre} cruzó un portal místico con *{personaje}* y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🛸 {nombre} vivió aventuras en otro universo con *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🌌", key: msg.key } });

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
  if (usuario.ultimoOtromundo && (ahora - usuario.ultimoOtromundo) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoOtromundo)) / 1000);
    const min = Math.floor(falta / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${min}m ${seg}s* para volver a viajar a otro mundo.` }, { quoted: msg });
  }

  // Límite diario
  const hoy = hoyStrLocal();
  usuario.otromundoDiario = usuario.otromundoDiario || { fecha: hoy, creditos: 0, xp: 0 };
  if (usuario.otromundoDiario.fecha !== hoy) {
    usuario.otromundoDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - usuario.otromundoDiario.creditos);
  const restanteXP = Math.max(0, TOPE_XP_DIA - usuario.otromundoDiario.xp);
  if (restanteCred <= 0 && restanteXP <= 0) {
    return conn.sendMessage(chatId, { text: `🛑 Límite diario de *otromundo* alcanzado.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP* con este comando.` }, { quoted: msg });
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

  let creditosGanados = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  let xpGanada = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  creditosGanados = Math.min(creditosGanados, restanteCred);
  xpGanada = Math.min(xpGanada, restanteXP);

  if (creditosGanados <= 0 && xpGanada <= 0) {
    return conn.sendMessage(chatId, { text: `🛑 Ya alcanzaste el tope diario de *otromundo*.` }, { quoted: msg });
  }

  usuario.ultimoOtromundo = ahora;
  usuario.creditos = (usuario.creditos || 0) + creditosGanados;

  let subioNivelPersonaje = false;
  personaje.xp += xpGanada;
  let xpNecesaria = XP_PERSONAJE_BASE + (personaje.nivel * 25);
  while (personaje.xp >= xpNecesaria) {
    personaje.xp -= xpNecesaria;
    personaje.nivel++;
    subioNivelPersonaje = true;
    xpNecesaria = XP_PERSONAJE_BASE + (personaje.nivel * 25);
  }

  const idxHab = Math.random() < 0.5 ? 0 : 1;
  const hab = personaje.habilidades[idxHab];
  let habilidadSubida = null;
  if (hab.nivel < 100) {
    hab.xp += xpGanada;
    let xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    while (hab.xp >= xpNecesariaHab && hab.nivel < 100) {
      hab.xp -= xpNecesariaHab;
      hab.nivel++;
      habilidadSubida = `${hab.nombre} (Nv ${hab.nivel})`;
      xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    }
  }

  usuario.otromundoDiario.creditos += creditosGanados;
  usuario.otromundoDiario.xp += xpGanada;

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));

  const base = TEXTOS_OTROMUNDO[Math.floor(Math.random() * TEXTOS_OTROMUNDO.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`.trim())
    .replace("{personaje}", personaje.nombre || "tu personaje")
    .replace("{creditos}", creditosGanados)
    .replace("{xp}", xpGanada);

  let mensajeFinal = base;
  if (subioNivelPersonaje) mensajeFinal += `\n\n🎉 *¡${personaje.nombre || "Tu personaje"} subió a nivel ${personaje.nivel}!*`;
  if (habilidadSubida) mensajeFinal += `\n\n✨ *Habilidad de personaje mejorada:* ${habilidadSubida}`;

  await conn.sendMessage(chatId, { text: mensajeFinal, quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["otromundo"];
export default handler;
