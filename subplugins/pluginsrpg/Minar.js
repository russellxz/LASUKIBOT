// plugins/minar.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000; // 7 min
const XP_NIVEL_BASE = 100;
const XP_HABILIDAD_BASE = 50;
const CREDITOS_MIN = 100;
const CREDITOS_MAX = 500;

// Topes diarios por usuario SOLO para este comando
const TOPE_CREDITOS_DIA = 8000;
const TOPE_XP_DIA = 10000;

const TEXTOS_MINAR = [
  "⛏️ {nombre} picó unas rocas y encontró 💳 {creditos} créditos y ✨ {xp} XP.",
  "💎 {nombre} exploró una mina abandonada y obtuvo 💳 {creditos} créditos y ✨ {xp} XP.",
  "🪨 {nombre} trabajó duro en la cantera y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "⚒️ {nombre} encontró un filón raro y recibió 💳 {creditos} créditos y ✨ {xp} XP.",
  "🔨 {nombre} minó con fuerza y consiguió 💳 {creditos} créditos y ✨ {xp} XP.",
  "💠 {nombre} halló gemas valiosas y ganó 💳 {creditos} créditos y ✨ {xp} XP.",
  "🏔️ {nombre} extrajo minerales preciosos y obtuvo 💳 {creditos} créditos y ✨ {xp} XP."
];

function hoyStrLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "⛏️", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte." }, { quoted: msg });
  }

  // Cooldown
  const ahora = Date.now();
  if (usuario.ultimoMinado && (ahora - usuario.ultimoMinado) < COOLDOWN_MS) {
    const falta = Math.ceil((COOLDOWN_MS - (ahora - usuario.ultimoMinado)) / 1000);
    const min = Math.floor(falta / 60);
    const seg = falta % 60;
    return conn.sendMessage(chatId, { text: `⏳ Debes esperar *${min}m ${seg}s* para volver a minar.` }, { quoted: msg });
  }

  // Control diario por usuario (solo para MINAR)
  const hoy = hoyStrLocal();
  if (!usuario.minarDiario || usuario.minarDiario.fecha !== hoy) {
    usuario.minarDiario = { fecha: hoy, creditos: 0, xp: 0 };
  }

  const restanteCred = Math.max(0, TOPE_CREDITOS_DIA - (usuario.minarDiario.creditos || 0));
  const restanteXP = Math.max(0, TOPE_XP_DIA - (usuario.minarDiario.xp || 0));

  if (restanteCred === 0 && restanteXP === 0) {
    return conn.sendMessage(
      chatId,
      { text: `🛑 Límite diario alcanzado en *MINAR*.\nHoy ya farmeaste *${TOPE_CREDITOS_DIA} créditos* y *${TOPE_XP_DIA} XP* con este comando.\nVuelve mañana. 😊` },
      { quoted: msg }
    );
  }

  // Generar recompensas base
  const creditosBase = Math.floor(Math.random() * (CREDITOS_MAX - CREDITOS_MIN + 1)) + CREDITOS_MIN;
  const bonoNivel = (usuario.nivel || 1) * 50;
  const creditosGanados = creditosBase + bonoNivel;

  const xpGanada = Math.floor(Math.random() * (500 - 100 + 1)) + 100;

  // Ajustar por tope diario
  const creditosOtorgados = Math.min(creditosGanados, restanteCred);
  const xpOtorgada = Math.min(xpGanada, restanteXP);

  // Si no queda nada para otorgar, avisar sin consumir cooldown
  if (creditosOtorgados === 0 && xpOtorgada === 0) {
    return conn.sendMessage(
      chatId,
      { text: `🛑 Ya llegaste al tope de hoy en *MINAR*.\nCréditos diarios: *${TOPE_CREDITOS_DIA}*, XP diaria: *${TOPE_XP_DIA}*.\nVuelve mañana. 🙌` },
      { quoted: msg }
    );
  }

  // Consumir cooldown aquí (solo si sí otorga algo)
  usuario.ultimoMinado = ahora;

  // Aplicar recompensas ajustadas
  usuario.creditos = (usuario.creditos || 0) + creditosOtorgados;
  usuario.nivel = usuario.nivel || 1;
  usuario.xp = (usuario.xp || 0) + xpOtorgada;

  // Actualizar acumulados del día
  usuario.minarDiario.creditos += creditosOtorgados;
  usuario.minarDiario.xp += xpOtorgada;

  // Subida de nivel (usuario)
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

  // Elegir UNA habilidad aleatoria
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

  // Guardar DB
  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // Mensaje: SOLO lo ganado + subidas (si hubo), citando SIEMPRE al usuario
  const base = TEXTOS_MINAR[Math.floor(Math.random() * TEXTOS_MINAR.length)]
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

  // Nota opcional si se topó el límite
  if (creditosOtorgados < creditosGanados || xpOtorgada < xpGanada) {
    const restC = TOPE_CREDITOS_DIA - usuario.minarDiario.creditos;
    const restX = TOPE_XP_DIA - usuario.minarDiario.xp;
    mensajeFinal += `\n\n⚠️ Tope diario alcanzado parcialmente en *MINAR*.\nAún puedes obtener hoy: ` +
      `${Math.max(0, restC)} créditos y ${Math.max(0, restX)} XP.`;
  }

  await conn.sendMessage(chatId, { text: mensajeFinal }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["minar"];
export default handler;
