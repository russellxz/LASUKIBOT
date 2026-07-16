// plugins/gouser.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const EDIT_DELAY = 1500;

const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const XP_USER_BASE = 150; // base para subir nivel del USUARIO
const XP_HAB_BASE  = 80;

// Recompensas (ganador > perdedor)
const WIN_CRED_MIN = 600, WIN_CRED_MAX = 900;
const WIN_XP_MIN   = 700, WIN_XP_MAX   = 1000;
const LOSE_CRED_MIN = 250, LOSE_CRED_MAX = 400;
const LOSE_XP_MIN   = 300, LOSE_XP_MAX   = 500;

const FILE = path.join(process.cwd(), "sukirpg.json");
const load = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf-8")) : { usuarios: [] };
const save = (db) => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const toNum = (j) => String(j || "").replace(/\D/g, "");
const rng = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const hoyStr = ()=>{
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const fmt = (n)=> (n|0);

async function editOrSend(conn, chatId, lastKey, text, mentions, quoted) {
  try {
    if (lastKey) {
      await conn.sendMessage(chatId, { text, edit: lastKey, mentions }, { quoted });
      return lastKey;
    }
    const sent = await conn.sendMessage(chatId, { text, mentions }, { quoted });
    return sent?.key || lastKey;
  } catch {
    const sent = await conn.sendMessage(chatId, { text, mentions }, { quoted });
    return sent?.key || lastKey;
  }
}

const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;
  const myJid = msg.key.participant || msg.key.remoteJid; // aceptante
  const myNum = toNum(myJid);

  await conn.sendMessage(chatId, { react: { text: "🎌", key: msg.key } });

  let db = load(); db.usuarios = db.usuarios || [];
  const me = db.usuarios.find(u => u.numero === myNum);
  if (!me) return conn.sendMessage(chatId, { text: "❌ *No estás registrado en el RPG.*" }, { quoted: msg });

  // 1) ¿Quién me desafió (tipo user)?
  let challenger = db.usuarios.find(u =>
    u.battleRequest && u.battleRequest.type === "user" && toNum(u.battleRequest.target) === myNum
  );

  // 2) Si no hay, avisar si yo fui el retador
  if (!challenger) {
    if (me.battleRequest && me.battleRequest.type === "user") {
      const targetNum = toNum(me.battleRequest.target);
      const faltan = Math.max(0, 120000 - (Date.now() - me.battleRequest.time));
      const seg = Math.ceil(faltan/1000);
      return conn.sendMessage(
        chatId,
        { text: `📨 *Ya enviaste un desafío de usuarios.*\nEl usuario +${targetNum} debe aceptar con *.${global?.prefix || ""}gouser*.\n⏳ Expira en ~${seg}s.` },
        { quoted: msg }
      );
    }
    return conn.sendMessage(chatId, { text: "⚠️ *No tienes un desafío de usuarios pendiente.*" }, { quoted: msg });
  }

  // Expiración 2 min
  if ((Date.now() - challenger.battleRequest.time) > 2*60*1000) {
    delete challenger.battleRequest;
    save(db);
    return conn.sendMessage(chatId, { text: "⏳ *La solicitud de batalla de usuarios ha expirado.*" }, { quoted: msg });
  }

  // Cooldown del aceptante
  me.cooldowns = me.cooldowns || {};
  if (me.cooldowns.batallaUser && (Date.now() - me.cooldowns.batallaUser) < COOLDOWN_MS) {
    const falt = Math.ceil((COOLDOWN_MS - (Date.now() - me.cooldowns.batallaUser))/1000);
    return conn.sendMessage(chatId, { text: `⏳ *Debes esperar ${falt}s para aceptar batallas.*` }, { quoted: msg });
  }
  // Aplicar cooldown a ambos
  challenger.cooldowns = challenger.cooldowns || {};
  challenger.cooldowns.batallaUser = Date.now();
  me.cooldowns.batallaUser = Date.now();

  // Asegurar estructura de ambos usuarios (nivel/xp y 2 habilidades con xp)
  const ensureUser = (u)=>{
    u.nivel = u.nivel || 1;
    u.xp = u.xp || 0;
    if (!Array.isArray(u.habilidades) || u.habilidades.length < 2) {
      u.habilidades = [
        { nombre: "Habilidad 1", nivel: 1, xp: 0 },
        { nombre: "Habilidad 2", nivel: 1, xp: 0 },
      ];
    } else {
      for (const h of u.habilidades) {
        h.nivel = h.nivel || 1;
        h.xp = h.xp || 0;
      }
    }
  };
  ensureUser(challenger);
  ensureUser(me);

  const cTag = `${challenger.numero}@s.whatsapp.net`;
  const mTag = `${me.numero}@s.whatsapp.net`;
  const mentions = [cTag, mTag];

  const nameC = `${challenger.nombre||""} ${challenger.apellido||""}`.trim() || challenger.numero;
  const nameM = `${me.nombre||""} ${me.apellido||""}`.trim() || me.numero;

  // Animación (5 steps)
  let sent = await conn.sendMessage(
    chatId,
    { text: `🎌 *¡Batalla entre Usuarios!*\n@${challenger.numero} (${nameC}) vs @${me.numero} (${nameM})\n\n¡Comienza el duelo!`, mentions },
    { quoted: msg }
  );
  let lastKey = sent?.key;

  const frames = [
    `🔥 @${challenger.numero} presiona con combos; @${me.numero} resiste firme.`,
    `⚡ @${me.numero} contraataca con rapidez; @${challenger.numero} esquiva al límite.`,
    `💥 Choque frontal, ninguno cede terreno…`,
    `🛡️ Tácticas y feints: ambos calculan su golpe final.`,
    `🌪️ ¡Ataque decisivo a punto de caer!`
  ];
  for (const f of frames) {
    await sleep(EDIT_DELAY);
    lastKey = await editOrSend(
      conn, chatId, lastKey,
      `🎌 *Batalla entre Usuarios*\n@${challenger.numero} (${nameC}) vs @${me.numero} (${nameM})\n\n${f}`,
      mentions,
      msg
    );
  }

  // Determinar ganador por "stats" de USUARIO (nivel + habilidades)
  const statsC = (challenger.nivel||1)*5 + (challenger.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);
  const statsM = (me.nivel||1)*5 + (me.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);

  let ganador = challenger, perdedor = me;
  if (statsM > statsC) { ganador = me; perdedor = challenger; }
  else if (statsM === statsC && Math.random() < 0.5) { ganador = challenger; perdedor = me; }

  // Topes diarios por usuario (modo user)
  const hoy = hoyStr();
  function restante(u){
    u.batallaUserDiario = u.batallaUserDiario || { fecha: hoy, creditos: 0, xp: 0 };
    if (u.batallaUserDiario.fecha !== hoy) u.batallaUserDiario = { fecha: hoy, creditos: 0, xp: 0 };
    return {
      cred: Math.max(0, TOPE_CREDITOS_DIA - (u.batallaUserDiario.creditos||0)),
      xp:   Math.max(0, TOPE_XP_DIA      - (u.batallaUserDiario.xp||0)),
    };
  }

  const rewG = { cred: rng(WIN_CRED_MIN, WIN_CRED_MAX),  xp: rng(WIN_XP_MIN, WIN_XP_MAX) };
  const rewP = { cred: rng(LOSE_CRED_MIN, LOSE_CRED_MAX), xp: rng(LOSE_XP_MIN, LOSE_XP_MAX) };

  function applyRewards(u, base) {
    const rest = restante(u);
    const cred = Math.min(base.cred, rest.cred);
    const xp   = Math.min(base.xp,   rest.xp);

    u.creditos = (u.creditos || 0) + cred;

    // subir NIVEL del USUARIO
    u.xp += xp;
    let subio = false;
    let req = XP_USER_BASE + (u.nivel * 25);
    while (u.xp >= req) {
      u.xp -= req;
      u.nivel += 1;
      subio = true;
      req = XP_USER_BASE + (u.nivel * 25);
    }

    // subir 1 habilidad del USUARIO
    let subHab = null;
    const idx = Math.random() < 0.5 ? 0 : 1;
    const h = u.habilidades[idx];
    if (h.nivel < 100) {
      h.xp += xp;
      let reqH = XP_HAB_BASE + (h.nivel * 12);
      while (h.xp >= reqH && h.nivel < 100) {
        h.xp -= reqH;
        h.nivel += 1;
        subHab = `${h.nombre} (Nv ${h.nivel})`;
        reqH = XP_HAB_BASE + (h.nivel * 12);
      }
    }

    // diario
    u.batallaUserDiario.creditos += cred;
    u.batallaUserDiario.xp += xp;

    return { cred, xp, subio, subHab };
  }

  const resG = applyRewards(ganador, rewG);
  const resP = applyRewards(perdedor, rewP);

  // limpiar solicitud
  delete challenger.battleRequest;
  save(db);

  // Resultado final (edición)
  await sleep(EDIT_DELAY);
  await editOrSend(
    conn, chatId, lastKey,
`🏁 *Resultado: Batalla entre Usuarios*
👑 Ganador: @${ganador.numero} (+${fmt(resG.cred)} créditos, +${fmt(resG.xp)} XP)
💤 Perdedor: @${perdedor.numero} (+${fmt(resP.cred)} créditos, +${fmt(resP.xp)} XP)`,
    [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`],
    msg
  );

  // Subidas
  let extra = "";
  if (resG.subio) extra += `\n🎉 @${ganador.numero} sube a *Nv ${ganador.nivel}*!`;
  if (resG.subHab) extra += `\n✨ Habilidad mejorada (ganador): ${resG.subHab}`;
  if (resP.subio) extra += `\n🎉 @${perdedor.numero} sube a *Nv ${perdedor.nivel}*!`;
  if (resP.subHab) extra += `\n✨ Habilidad mejorada (perdedor): ${resP.subHab}`;

  if (extra) {
    await conn.sendMessage(
      chatId,
      { text: extra, mentions: [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`] },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["gouser"];
export default handler;
