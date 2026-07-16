// plugins/pasear.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000; // 7 min
const XP_MASCOTA_BASE = 120;
const XP_HAB_BASE = 60;

// Recompensas pensadas como en daragua (rango medio)
const CREDITOS_MIN = 150;
const CREDITOS_MAX = 280;
const XP_MIN = 180;
const XP_MAX = 300;

// Topes diarios SOLO para este comando
const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const TEXTOS_PASEAR = [
  "🚶‍♂️ {nombre} paseó a *{mascota}* por el parque y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🐕 {nombre} salió a correr con *{mascota}* y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🌇 {nombre} dio una caminata al atardecer con *{mascota}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🌳 {nombre} entrenó obediencia con *{mascota}* y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🏞️ {nombre} exploró senderos con *{mascota}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🎾 {nombre} jugó a la pelota con *{mascota}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🌦️ {nombre} paseó bajo la lluvia con *{mascota}* y recibió 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // Reacción
  await conn.sendMessage(chatId, { react: { text: "🐾", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath, "utf-8")) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte.",
      quoted: msg
    });
  }

  // Verificar mascota principal
  if (!Array.isArray(usuario.mascotas) || usuario.mascotas.length === 0) {
    return conn.sendMessage(chatId, {
      text: "🐾 No tienes una mascota aún. Compra una en la tienda para poder usar este comando.",
      quoted: msg
    });
  }

  const mascota = usuario.mascotas[0];
  mascota.nivel = mascota.nivel || 1;
  mascota.xp = mascota.xp || 0;

  // Asegurar habilidades de mascota (2)
  mascota.habilidades = Array.isArray(mascota.habilidades) && mascota.habilidades.length >= 2
    ? mascota.habilidades
    : [
        { nombre: "Habilidad Mascota 1", nivel: 1, xp: 0 },
        { nombre: "Habilidad Mascota 2", nivel: 1, xp: 0 }
      ];
  for (const h of mascota.habilidades) {
    h.nivel = h.nivel || 1;
    h.xp = h.xp || 0;
  }

  // Cooldown
  const ahora = Date.now();
  if (usuario.ultimoPasear && (ahora - usuario.ultimoPasear) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoPasear))/1000);
    const min = Math.floor(falta/60), seg = falta%60;
    return conn.sendMessage(chatId, {
      text: `⏳ Debes esperar *${min}m ${seg}s* para volver a pasear.`,
      quoted: msg
    });
  }

  // Topes diarios por usuario (solo PASEAR)
  const hoy = hoyStrLocal();
  if (!usuario.pasearDiario || usuario.pasearDiario.fecha !== hoy) {
    usuario.pasearDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.pasearDiario.creditos || 0));
  const restanteXP   = Math.max(0, TOPE_XP_DIA      - (usuario.pasearDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(chatId, {
      text: `🛑 Límite diario de *pasear* alcanzado.\nVuelve mañana. 😊`,
      quoted: msg
    });
  }

  // Recompensas (capadas por tope)
  const credRand = Math.floor(Math.random()*(CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const xpRand   = Math.floor(Math.random()*(XP_MAX - XP_MIN + 1)) + XP_MIN;

  const creditosOtorgados = Math.min(credRand, restanteCred);
  const xpOtorgada        = Math.min(xpRand,   restanteXP);

  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(chatId, {
      text: `🛑 Ya alcanzaste el tope diario de *pasear*.`,
      quoted: msg
    });
  }

  // Aplicar recompensas
  usuario.ultimoPasear = ahora;
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;

  // Subida de nivel de la mascota
  let subioNivelMascota = false;
  mascota.xp += xpOtorgada;
  let xpNecesariaMascota = XP_MASCOTA_BASE + (mascota.nivel * 25);
  while (mascota.xp >= xpNecesariaMascota) {
    mascota.xp -= xpNecesariaMascota;
    mascota.nivel += 1;
    subioNivelMascota = true;
    xpNecesariaMascota = XP_MASCOTA_BASE + (mascota.nivel * 25);
  }

  // Subir SOLO una habilidad aleatoria de la mascota
  const idxHab = Math.random() < 0.5 ? 0 : 1;
  const hab = mascota.habilidades[idxHab];
  let habilidadSubida = null;

  if (hab.nivel < 100) {
    hab.xp += xpOtorgada;
    let xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    while (hab.xp >= xpNecesariaHab && hab.nivel < 100) {
      hab.xp -= xpNecesariaHab;
      hab.nivel += 1;
      habilidadSubida = `${hab.nombre} (Nv ${hab.nivel})`;
      xpNecesariaHab = XP_HAB_BASE + (hab.nivel * 12);
    }
  }

  // Actualizar acumulados del día
  usuario.pasearDiario.creditos += creditosOtorgados;
  usuario.pasearDiario.xp += xpOtorgada;

  // Guardar
  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // Mensaje final con texto aleatorio
  const nombreTexto = `${usuario.nombre} ${usuario.apellido}`.trim();
  const mascotaNombre = String(mascota.nombre || "tu mascota");
  const base = TEXTOS_PASEAR[Math.floor(Math.random() * TEXTOS_PASEAR.length)]
    .replace("{nombre}", nombreTexto)
    .replace("{mascota}", mascotaNombre)
    .replace("{creditos}", creditosOtorgados)
    .replace("{xp}", xpOtorgada);

  let mensajeFinal = base;
  if (subioNivelMascota) mensajeFinal += `\n\n🎉 *¡${mascotaNombre} subió a nivel ${mascota.nivel}!*`;
  if (habilidadSubida)  mensajeFinal += `\n\n✨ *Habilidad de mascota mejorada:* ${habilidadSubida}`;

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["pasear"];
export default handler;
