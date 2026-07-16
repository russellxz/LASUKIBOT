// plugins/darcomida.js
import fs from 'fs';
import path from 'path';

// Cooldown y escalados
const COOLDOWN_MS = 7 * 60 * 1000; // 7 min
const XP_MASCOTA_BASE = 120;       // XP base para subir de nivel de mascota
const XP_HAB_BASE = 60;            // XP base para subir de nivel de habilidad de la mascota

// Recompensas diseñadas para alcanzar el tope en ~5 horas (≈42 usos)
const CREDITOS_MIN = 150;
const CREDITOS_MAX = 280;
const XP_MIN = 180;
const XP_MAX = 300;

// Topes diarios de ESTE comando
const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

// Textos aleatorios
const TEXTOS_DARCOMIDA = [
  "🍖 {nombre} alimentó a *{mascota}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🥩 {nombre} preparó una comida épica para *{mascota}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🍗 {nombre} dio de comer a *{mascota}* y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🥕 {nombre} cuidó la dieta de *{mascota}* y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🍳 {nombre} cocinó para *{mascota}* y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🍼 {nombre} alimentó con cariño a *{mascota}* y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🍰 {nombre} dio un postre a *{mascota}* y recibió 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // Reacción
  await conn.sendMessage(chatId, { react: { text: "🍖", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  // Verificar mascota principal
  if (!Array.isArray(usuario.mascotas) || usuario.mascotas.length === 0) {
    return conn.sendMessage(chatId, { text: "🐾 No tienes una mascota aún. Compra una en la tienda para poder usar este comando." }, { quoted: msg });
  }

  const mascota = usuario.mascotas[0];
  mascota.nivel = mascota.nivel || 1;
  mascota.xp = mascota.xp || 0;

  // Asegurar dos habilidades en la mascota
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
  if (usuario.ultimoDarComida && (ahora - usuario.ultimoDarComida) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoDarComida)) / 1000);
    const min = Math.floor(falta / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${min}m ${seg}s* para volver a dar comida.`, quoted: msg });
  }

  // Topes diarios por comando
  const hoy = hoyStrLocal();
  if (!usuario.darcomidaDiario || usuario.darcomidaDiario.fecha !== hoy) {
    usuario.darcomidaDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.darcomidaDiario.creditos || 0));
  const restanteXP = Math.max(0, TOPE_XP_DIA - (usuario.darcomidaDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(
      chatId,
      { text: `🛑 Límite diario de *darcomida* alcanzado.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP* con este comando.` },
      { quoted: msg }
    );
  }

  // Recompensas aleatorias (capadas por tope)
  const creditosRand = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const xpRand = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  const creditosOtorgados = Math.min(creditosRand, restanteCred);
  const xpOtorgada = Math.min(xpRand, restanteXP);

  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(chatId, { text: `🛑 Ya alcanzaste el tope diario de *darcomida*.`, quoted: msg });
  }

  // Aplicar recompensas
  usuario.ultimoDarComida = ahora;
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;

  // Subida de nivel de la MASCOTA
  let subioNivelMascota = false;
  mascota.xp += xpOtorgada;
  let xpNecesariaMascota = XP_MASCOTA_BASE + (mascota.nivel * 25);
  while (mascota.xp >= xpNecesariaMascota) {
    mascota.xp -= xpNecesariaMascota;
    mascota.nivel += 1;
    subioNivelMascota = true;
    xpNecesariaMascota = XP_MASCOTA_BASE + (mascota.nivel * 25);
  }

  // Subir SOLO UNA habilidad aleatoria de la mascota
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

  // Actualizar tope diario
  usuario.darcomidaDiario.creditos += creditosOtorgados;
  usuario.darcomidaDiario.xp += xpOtorgada;

  // Guardar DB
  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // Mensaje FINAL (solo lo ganado + notificaciones de subida)
  const nombreTexto = `${usuario.nombre} ${usuario.apellido}`.trim();
  const mascotaNombre = String(mascota.nombre || "Tu mascota");
  const base = TEXTOS_DARCOMIDA[Math.floor(Math.random() * TEXTOS_DARCOMIDA.length)]
    .replace("{nombre}", nombreTexto)
    .replace("{mascota}", mascotaNombre)
    .replace("{creditos}", creditosOtorgados)
    .replace("{xp}", xpOtorgada);

  let mensajeFinal = base;
  if (subioNivelMascota) {
    mensajeFinal += `\n\n🎉 *¡${mascotaNombre} subió a nivel ${mascota.nivel}!*`;
  }
  if (habilidadSubida) {
    mensajeFinal += `\n\n✨ *Habilidad de mascota mejorada:* ${habilidadSubida}`;
  }

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["darcomida"];
export default handler;
