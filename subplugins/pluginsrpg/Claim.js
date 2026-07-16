// plugins/claim.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 horas
const NIVEL_MINIMO = 20;
const XP_NIVEL_BASE = 100;
const XP_HABILIDAD_BASE = 50;
const CREDITOS_MIN = 500;
const CREDITOS_MAX = 1000;
const XP_MIN = 500;
const XP_MAX = 1500;

const TOPE_CREDITOS_DIA = 8000;
const TOPE_XP_DIA = 10000;

const TEXTOS_CLAIM = [
  "🎁 {nombre} reclamó su recompensa diaria y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "💰 {nombre} abrió un cofre misterioso y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🪙 {nombre} recibió su pago diario: 💳 {creditos} créditos y ✨ {xp} XP.",
  "📦 {nombre} encontró un regalo y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🏆 {nombre} fue premiado con 💳 {creditos} créditos y ✨ {xp} XP.",
  "🤑 {nombre} cobró su bonificación y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "💎 {nombre} reclamó tesoros por 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🎁", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  if ((usuario.nivel || 1) < NIVEL_MINIMO) {
    return conn.sendMessage(chatId, { text: `🚫 Necesitas ser al menos *nivel ${NIVEL_MINIMO}* para reclamar esta recompensa.`, quoted: msg });
  }

  const ahora = Date.now();
  if (usuario.ultimoClaim && (ahora - usuario.ultimoClaim) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoClaim)) / 1000);
    const horas = Math.floor(falta / 3600);
    const min = Math.floor((falta % 3600) / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${horas}h ${min}m ${seg}s* para volver a reclamar.`, quoted: msg });
  }

  const hoy = hoyStrLocal();
  if (!usuario.claimDiario || usuario.claimDiario.fecha !== hoy) {
    usuario.claimDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.claimDiario.creditos || 0));
  const restanteXP = Math.max(0, TOPE_XP_DIA - (usuario.claimDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(chatId, { text: `🛑 Límite diario alcanzado en *CLAIM*.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP*.`, quoted: msg });
  }

  const creditosGanados = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const xpGanada = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  const creditosOtorgados = Math.min(creditosGanados, restanteCred);
  const xpOtorgada = Math.min(xpGanada, restanteXP);

  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(chatId, { text: `🛑 Ya alcanzaste el tope diario de *CLAIM*.`, quoted: msg });
  }

  usuario.ultimoClaim = ahora;
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;
  usuario.xp = (usuario.xp || 0) + xpOtorgada;

  usuario.claimDiario.creditos += creditosOtorgados;
  usuario.claimDiario.xp += xpOtorgada;

  let subioNivelUsuario = false;
  let xpNecesarioUsuario = XP_NIVEL_BASE + ((usuario.nivel || 1) * 20);
  while (usuario.xp >= xpNecesarioUsuario) {
    usuario.xp -= xpNecesarioUsuario;
    usuario.nivel = (usuario.nivel || 1) + 1;
    subioNivelUsuario = true;
    xpNecesarioUsuario = XP_NIVEL_BASE + (usuario.nivel * 20);
  }

  usuario.habilidades = usuario.habilidades || [
    { nombre: "Habilidad 1", nivel: 1, xp: 0 },
    { nombre: "Habilidad 2", nivel: 1, xp: 0 }
  ];

  let habilidadesSubidas = [];
  const hab = usuario.habilidades[Math.floor(Math.random() * usuario.habilidades.length)];
  hab.xp = (hab.xp || 0) + xpOtorgada;
  if (hab.nivel < 100) {
    let xpNecesarioHabilidad = XP_HABILIDAD_BASE + (hab.nivel * 10);
    while (hab.xp >= xpNecesarioHabilidad && hab.nivel < 100) {
      hab.xp -= xpNecesarioHabilidad;
      hab.nivel++;
      habilidadesSubidas.push(`${hab.nombre} (Nv ${hab.nivel})`);
      xpNecesarioHabilidad = XP_HABILIDAD_BASE + (hab.nivel * 10);
    }
  }

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  const texto = TEXTOS_CLAIM[Math.floor(Math.random() * TEXTOS_CLAIM.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`)
    .replace("{creditos}", creditosOtorgados)
    .replace("{xp}", xpOtorgada);

  let mensajeFinal = `${texto}`;
  if (subioNivelUsuario) mensajeFinal += `\n\n🎉 *¡Has subido al nivel ${usuario.nivel}!*`;
  if (habilidadesSubidas.length > 0) mensajeFinal += `\n\n✨ *Habilidad mejorada:*\n- ${habilidadesSubidas.join("\n- ")}`;

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["claim"];
export default handler;
