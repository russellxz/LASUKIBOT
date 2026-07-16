// plugins/cofre.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 horas
const NIVEL_MINIMO = 25;

const XP_NIVEL_BASE = 100;
const XP_HABILIDAD_BASE = 50;

const CREDITOS_MIN = 700;
const CREDITOS_MAX = 2000;
const XP_MIN = 700;
const XP_MAX = 3000;

// Topes DIARIOS SOLO para este comando (cofre)
const TOPE_CREDITOS_DIA = 8000;  // ajusta si quieres
const TOPE_XP_DIA = 10000;       // ajusta si quieres

const TEXTOS_COFRE = [
  "💎 {nombre} abrió un cofre legendario y encontró 💳 {creditos} créditos y ✨ {xp} XP.",
  "🎁 {nombre} halló un tesoro escondido con 💳 {creditos} créditos y ✨ {xp} XP.",
  "🪙 {nombre} recibió la bendición de la fortuna: 💳 {creditos} créditos y ✨ {xp} XP.",
  "🏆 {nombre} desbloqueó un cofre de premios con 💳 {creditos} créditos y ✨ {xp} XP.",
  "📦 {nombre} reclamó un botín y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🤑 {nombre} encontró riquezas ocultas: 💳 {creditos} créditos y ✨ {xp} XP.",
  "💠 {nombre} abrió un cofre mágico y recibió 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "💎", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  // Nivel mínimo
  if ((usuario.nivel || 1) < NIVEL_MINIMO) {
    return conn.sendMessage(chatId, { text: `🚫 Necesitas ser al menos *nivel ${NIVEL_MINIMO}* para abrir el cofre.`, quoted: msg });
  }

  // Cooldown
  const ahora = Date.now();
  if (usuario.ultimoCofre && (ahora - usuario.ultimoCofre) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoCofre)) / 1000);
    const horas = Math.floor(falta / 3600);
    const min = Math.floor((falta % 3600) / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${horas}h ${min}m ${seg}s* para volver a abrir un cofre.`, quoted: msg });
  }

  // Topes diarios por comando (cofre)
  const hoy = hoyStrLocal();
  if (!usuario.cofreDiario || usuario.cofreDiario.fecha !== hoy) {
    usuario.cofreDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.cofreDiario.creditos || 0));
  const restanteXP = Math.max(0, TOPE_XP_DIA - (usuario.cofreDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(chatId, { text: `🛑 Límite diario de *COFRE* alcanzado.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP* con este comando.`, quoted: msg });
  }

  // Recompensas aleatorias (capadas por tope)
  const creditosRand = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const xpRand = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  const creditosOtorgados = Math.min(creditosRand, restanteCred);
  const xpOtorgada = Math.min(xpRand, restanteXP);

  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(chatId, { text: `🛑 Ya alcanzaste el tope diario de *COFRE*.`, quoted: msg });
  }

  // Aplicar recompensas y cooldown
  usuario.ultimoCofre = ahora;
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;
  usuario.xp = (usuario.xp || 0) + xpOtorgada;

  usuario.cofreDiario.creditos += creditosOtorgados;
  usuario.cofreDiario.xp += xpOtorgada;

  // Subida de nivel usuario
  usuario.nivel = usuario.nivel || 1;
  let subioNivelUsuario = false;
  let xpNecesarioUsuario = XP_NIVEL_BASE + (usuario.nivel * 20);
  while (usuario.xp >= xpNecesarioUsuario) {
    usuario.xp -= xpNecesarioUsuario;
    usuario.nivel += 1;
    subioNivelUsuario = true;
    xpNecesarioUsuario = XP_NIVEL_BASE + (usuario.nivel * 20);
  }

  // Habilidades (2) y subir solo una aleatoria
  usuario.habilidades = Array.isArray(usuario.habilidades) && usuario.habilidades.length >= 2
    ? usuario.habilidades
    : [
        { nombre: "Habilidad 1", nivel: 1, xp: 0 },
        { nombre: "Habilidad 2", nivel: 1, xp: 0 }
      ];

  const idxHab = Math.random() < 0.5 ? 0 : 1;
  const hab = usuario.habilidades[idxHab];
  hab.nivel = hab.nivel || 1;
  hab.xp = (hab.xp || 0) + xpOtorgada;

  let habilidadSubida = null;
  if (hab.nivel < 100) {
    let xpNecesariaHab = XP_HABILIDAD_BASE + (hab.nivel * 10);
    while (hab.xp >= xpNecesariaHab && hab.nivel < 100) {
      hab.xp -= xpNecesariaHab;
      hab.nivel += 1;
      habilidadSubida = `${hab.nombre} (Nv ${hab.nivel})`;
      xpNecesariaHab = XP_HABILIDAD_BASE + (hab.nivel * 10);
    }
  }

  // Guardar
  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // Mensaje (solo lo ganado + notificaciones de subida)
  const base = TEXTOS_COFRE[Math.floor(Math.random() * TEXTOS_COFRE.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`)
    .replace("{creditos}", creditosOtorgados)
    .replace("{xp}", xpOtorgada);

  let mensajeFinal = base;
  if (subioNivelUsuario) mensajeFinal += `\n\n🎉 *¡Has subido al nivel ${usuario.nivel}!*`;
  if (habilidadSubida) mensajeFinal += `\n\n✨ *Habilidad mejorada:* ${habilidadSubida}`;

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["cofre"];
export default handler;
