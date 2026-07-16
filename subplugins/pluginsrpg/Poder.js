// plugins/poder.js
import fs from 'fs';
import path from 'path';

// Mismos parámetros que luchar/otromundo
const COOLDOWN_MS = 7 * 60 * 1000;
const XP_PERSONAJE_BASE = 150;
const XP_HAB_BASE = 80;
const CREDITOS_MIN = 250;
const CREDITOS_MAX = 400;
const XP_MIN = 450;
const XP_MAX = 600;
const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const TEXTOS_PODER = [
  "⚡ {nombre} concentró su energía con *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "📊 {nombre} refinó el poder de *{personaje}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🔋 {nombre} cargó el aura de *{personaje}* y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🧭 {nombre} dominó el ki de *{personaje}* y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "📈 {nombre} entrenó el poder de *{personaje}* y ganó 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "⚡", key: msg.key } });

  const filePath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento`." }, { quoted: msg });
  }
  if (!Array.isArray(usuario.personajes) || usuario.personajes.length === 0) {
    return conn.sendMessage(chatId, { text: "🎭 No tienes un personaje activo. Compra uno en la tienda." }, { quoted: msg });
  }

  const ahora = Date.now();
  if (usuario.ultimoPoder && (ahora - usuario.ultimoPoder) < COOLDOWN_MS) {
    const falt = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoPoder))/1000);
    const m = Math.floor(falt/60), s = falt%60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${m}m ${s}s* para volver a usar *poder*.` }, { quoted: msg });
  }

  // Topes diarios para este comando
  const hoy = hoyStrLocal();
  usuario.poderDiario = usuario.poderDiario || { fecha: hoy, creditos: 0, xp: 0 };
  if (usuario.poderDiario.fecha !== hoy) usuario.poderDiario = { fecha: hoy, creditos: 0, xp: 0 };

  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - usuario.poderDiario.creditos);
  const restanteXP   = Math.max(0, TOPE_XP_DIA      - usuario.poderDiario.xp);
  if (restanteCred <= 0 && restanteXP <= 0) {
    return conn.sendMessage(chatId, { text: `🛑 Límite diario de *poder* alcanzado.\nVuelve mañana.` }, { quoted: msg });
  }

  // Datos del personaje
  const pj = usuario.personajes[0];
  pj.nivel = pj.nivel || 1;
  pj.xp = pj.xp || 0;
  pj.habilidades = Array.isArray(pj.habilidades) && pj.habilidades.length >= 2
    ? pj.habilidades
    : [{ nombre: "Habilidad 1", nivel: 1, xp: 0 }, { nombre: "Habilidad 2", nivel: 1, xp: 0 }];
  for (const h of pj.habilidades) { h.nivel = h.nivel || 1; h.xp = h.xp || 0; }

  // Recompensas
  let cred = Math.floor(Math.random()*(CREDITOS_MAX-CREDITOS_MIN+1))+CREDITOS_MIN;
  let xp   = Math.floor(Math.random()*(XP_MAX-XP_MIN+1))+XP_MIN;
  cred = Math.min(cred, restanteCred);
  xp   = Math.min(xp, restanteXP);
  if (cred <= 0 && xp <= 0) {
    return conn.sendMessage(chatId, { text: `🛑 Ya alcanzaste el tope diario de *poder*.` }, { quoted: msg });
  }

  // Aplicar recompensas
  usuario.ultimoPoder = ahora;
  usuario.creditos = (usuario.creditos || 0) + cred;

  // Subir personaje
  let subioNivel = false;
  pj.xp += xp;
  let req = XP_PERSONAJE_BASE + (pj.nivel * 25);
  while (pj.xp >= req) {
    pj.xp -= req;
    pj.nivel += 1;
    subioNivel = true;
    req = XP_PERSONAJE_BASE + (pj.nivel * 25);
  }

  // Subir 1 habilidad aleatoria
  const iHab = Math.random() < 0.5 ? 0 : 1;
  const hab = pj.habilidades[iHab];
  let habUp = null;
  if (hab.nivel < 100) {
    hab.xp += xp;
    let reqH = XP_HAB_BASE + (hab.nivel * 12);
    while (hab.xp >= reqH && hab.nivel < 100) {
      hab.xp -= reqH;
      hab.nivel += 1;
      habUp = `${hab.nombre} (Nv ${hab.nivel})`;
      reqH = XP_HAB_BASE + (hab.nivel * 12);
    }
  }

  usuario.poderDiario.creditos += cred;
  usuario.poderDiario.xp += xp;

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));

  // Mensaje final con texto aleatorio
  const base = TEXTOS_PODER[Math.floor(Math.random() * TEXTOS_PODER.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`.trim())
    .replace("{personaje}", pj.nombre || "tu personaje")
    .replace("{creditos}", cred)
    .replace("{xp}", xp);

  let out = base;
  if (subioNivel) out += `\n\n🎉 *¡${pj.nombre || "Tu personaje"} subió a nivel ${pj.nivel}!*`;
  if (habUp) out += `\n✨ *Habilidad mejorada:* ${habUp}`;

  await conn.sendMessage(chatId, { text: out }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["poder"];
export default handler;
