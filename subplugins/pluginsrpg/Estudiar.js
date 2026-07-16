// plugins/estudiar.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000; // 7 minutos
const XP_NIVEL_BASE = 100;
const XP_HABILIDAD_BASE = 50;
const CREDITOS_MIN = 100;
const CREDITOS_MAX = 500;
const XP_MIN = 100;
const XP_MAX = 500;

// Topes diarios por comando (mismos que minar)
const TOPE_CREDITOS_DIA = 8000;
const TOPE_XP_DIA = 10000;

const TEXTOS_ESTUDIAR = [
  "📚 {nombre} estudió toda la noche y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "📝 {nombre} hizo todos sus deberes y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "📖 {nombre} leyó un libro entero y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "💡 {nombre} aprendió algo nuevo y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🎓 {nombre} asistió a clases y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🧠 {nombre} resolvió ejercicios difíciles y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🏫 {nombre} participó en un taller y obtuvo 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal () {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "📚", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  // Cooldown (solo se consume si otorgamos algo)
  const ahora = Date.now();
  if (usuario.ultimoEstudiar && (ahora - usuario.ultimoEstudiar) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoEstudiar)) / 1000);
    const min = Math.floor(falta / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${min}m ${seg}s* para volver a estudiar.`, quoted: msg });
  }

  // Control diario de ESTUDIAR
  const hoy = hoyStrLocal();
  if (!usuario.estudiarDiario || usuario.estudiarDiario.fecha !== hoy) {
    usuario.estudiarDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }
  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.estudiarDiario.creditos || 0));
  const restanteXP = Math.max(0, TOPE_XP_DIA - (usuario.estudiarDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(
      chatId,
      { text: `🛑 Límite diario alcanzado en *ESTUDIAR*.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP* con este comando.\nVuelve mañana. 😊` },
      { quoted: msg }
    );
  }

  // Recompensas base
  const creditosBase = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const bonoNivel = (usuario.nivel || 1) * 50;
  const creditosGanados = creditosBase + bonoNivel;

  const xpGanada = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  // Ajustar por tope diario
  const creditosOtorgados = Math.min(creditosGanados, restanteCred);
  const xpOtorgada = Math.min(xpGanada, restanteXP);

  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(
      chatId,
      { text: `🛑 Ya llegaste al tope de hoy en *ESTUDIAR*.\nCréditos diarios: *${TOPE_CREDITOS_DIA}*, XP diaria: *${TOPE_XP_DIA}*.\nVuelve mañana. 🙌` },
      { quoted: msg }
    );
  }

  // Consumimos cooldown porque sí ganará algo
  usuario.ultimoEstudiar = ahora;

  // Aplicar recompensas
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;
  usuario.nivel = usuario.nivel || 1;
  usuario.xp = (usuario.xp || 0) + xpOtorgada;

  // Acumular en el día
  usuario.estudiarDiario.creditos += creditosOtorgados;
  usuario.estudiarDiario.xp += xpOtorgada;

  // Subida de nivel del usuario
  let subioNivelUsuario = false;
  let xpNecesarioUsuario = XP_NIVEL_BASE + (usuario.nivel * 20);
  while (usuario.xp >= xpNecesarioUsuario) {
    usuario.xp -= xpNecesarioUsuario;
    usuario.nivel += 1;
    subioNivelUsuario = true;
    xpNecesarioUsuario = XP_NIVEL_BASE + (usuario.nivel * 20);
  }

  // Asegurar 2 habilidades
  usuario.habilidades = Array.isArray(usuario.habilidades) && usuario.habilidades.length >= 2
    ? usuario.habilidades
    : [
        { nombre: "Habilidad 1", nivel: 1, xp: 0 },
        { nombre: "Habilidad 2", nivel: 1, xp: 0 }
      ];

  // Subir SOLO una habilidad aleatoria
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

  // Mensaje final — SOLO lo ganado + subidas; SIEMPRE citando el comando del usuario
  const base = TEXTOS_ESTUDIAR[Math.floor(Math.random() * TEXTOS_ESTUDIAR.length)]
    .replace("{nombre}", `${usuario.nombre} ${usuario.apellido}`.trim())
    .replace("{creditos}", creditosOtorgados)
    .replace("{xp}", xpOtorgada);

  let mensajeFinal = base;
  if (subioNivelUsuario) {
    mensajeFinal += `\n\n🎉 *¡Has subido al nivel ${usuario.nivel}!*`;
  }
  if (habilidadSubida) {
    mensajeFinal += `\n✨ *Habilidad mejorada:* ${habilidadSubida}`;
  }

  if (creditosOtorgados < creditosGanados || xpOtorgada < xpGanada) {
    const restC = TOPE_CREDITOS_DIA - usuario.estudiarDiario.creditos;
    const restX = TOPE_XP_DIA - usuario.estudiarDiario.xp;
    mensajeFinal += `\n\n⚠️ Tope diario alcanzado parcialmente en *ESTUDIAR*.\nAún puedes obtener hoy: ${Math.max(0, restC)} créditos y ${Math.max(0, restX)} XP.`;
  }

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["estudiar"];
export default handler;
