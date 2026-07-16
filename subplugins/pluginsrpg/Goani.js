// plugins/goani.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const EDIT_DELAY = 1500;

const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const XP_PERSONAJE_BASE = 150;
const XP_HAB_BASE = 80;

// Recompensas base (ganador > perdedor)
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
const formatPts = (n)=> (n|0);

// 👉 ahora acepta 'mentions'
async function editOrSend(conn, chatId, lastKey, text, mentions, quoted) {
  try {
    await conn.sendMessage(chatId, { text, edit: lastKey, mentions }, { quoted });
    return lastKey;
  } catch {
    const sent = await conn.sendMessage(chatId, { text, mentions }, { quoted });
    return sent?.key || lastKey;
  }
}

const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;
  const userId = msg.key.participant || msg.key.remoteJid; // aceptante
  const myNum = toNum(userId);

  await conn.sendMessage(chatId, { react: { text: "🎌", key: msg.key } });

  let db = load();
  db.usuarios = db.usuarios || [];

  const me = db.usuarios.find(u => u.numero === myNum);
  if (!me) {
    return conn.sendMessage(chatId, { text: "❌ *No estás registrado en el RPG.*" }, { quoted: msg });
  }

  // Encontrar quién me desafió (type anime)
  const challenger = db.usuarios.find(u => u.battleRequest &&
                                           u.battleRequest.type === "anime" &&
                                           toNum(u.battleRequest.target) === myNum);
  if (!challenger) {
    return conn.sendMessage(chatId, { text: "⚠️ *No tienes ninguna solicitud de batalla anime pendiente.*" }, { quoted: msg });
  }

  // Verificar que no haya expirado (2 min)
  if ((Date.now() - challenger.battleRequest.time) > (2*60*1000)) {
    delete challenger.battleRequest;
    save(db);
    return conn.sendMessage(chatId, { text: "⏳ *La solicitud de batalla anime ha expirado.*" }, { quoted: msg });
  }

  // Cooldown del aceptante
  me.cooldowns = me.cooldowns || {};
  if (me.cooldowns.batallaAnime && (Date.now() - me.cooldowns.batallaAnime) < COOLDOWN_MS) {
    const falt = Math.ceil((COOLDOWN_MS - (Date.now() - me.cooldowns.batallaAnime))/1000);
    return conn.sendMessage(chatId, { text: `⏳ *Debes esperar ${falt}s para aceptar batallas.*` }, { quoted: msg });
  }

  // Asegurar personajes
  const ensureP = (u)=>{
    if (!Array.isArray(u.personajes) || u.personajes.length===0){
      u.personajes=[{nombre:"Tu personaje",nivel:1,xp:0,habilidades:[{nombre:"Habilidad 1",nivel:1,xp:0},{nombre:"Habilidad 2",nivel:1,xp:0}]}];
    }
    const p=u.personajes[0];
    p.nivel=p.nivel||1; p.xp=p.xp||0;
    p.habilidades = Array.isArray(p.habilidades)&&p.habilidades.length>=2 ? p.habilidades : [{nombre:"Habilidad 1",nivel:1,xp:0},{nombre:"Habilidad 2",nivel:1,xp:0}];
    for(const h of p.habilidades){ h.nivel=h.nivel||1; h.xp=h.xp||0; }
    return p;
  };

  const pC = ensureP(challenger);
  const pM = ensureP(me);

  // fijar cooldown a ambos ahora que inicia
  challenger.cooldowns = challenger.cooldowns || {};
  challenger.cooldowns.batallaAnime = Date.now();
  me.cooldowns.batallaAnime = Date.now();

  // Animación (5 pasos, 1.5s) con nombres de personajes
  const cTag = `${challenger.numero}@s.whatsapp.net`;
  const mTag = `${me.numero}@s.whatsapp.net`;
  const mentions = [cTag, mTag];

  let sent = await conn.sendMessage(
    chatId,
    { text: `🎌 *¡La batalla anime comienza!*\n👤 @${challenger.numero} (${pC.nombre || "Personaje A"}) vs 👤 @${me.numero} (${pM.nombre || "Personaje B"})\n\nPreparados...`, mentions },
    { quoted: msg }
  );
  let lastKey = sent?.key;

  const frames = [
    `🔥 *${pC.nombre || "A"}* lanza el primer ataque, pero *${pM.nombre || "B"}* responde con un contraataque veloz.`,
    `⚡ *${pM.nombre || "B"}* activa su técnica secreta; *${pC.nombre || "A"}* esquiva al límite.`,
    `💥 Choque brutal: *${pC.nombre || "A"}* y *${pM.nombre || "B"}* colisionan poderes ¡retumba el campo!`,
    `🛡️ *${pC.nombre || "A"}* bloquea y prepara combo; *${pM.nombre || "B"}* observa y calcula.`,
    `🌪️ Ambos cargan su *ataque final*… ¡el desenlace es inminente!`
  ];
  for (const f of frames) {
    await sleep(EDIT_DELAY);
    lastKey = await editOrSend(conn, chatId, lastKey,
      `🎌 *Batalla Anime*\n@${challenger.numero} (${pC.nombre || "A"}) vs @${me.numero} (${pM.nombre || "B"})\n\n${f}`,
      mentions,
      msg
    );
  }

  // Ganador por stats
  const statsC = (pC.nivel||1)*5 + (pC.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);
  const statsM = (pM.nivel||1)*5 + (pM.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);

  let ganador = challenger, gChar = pC, perdedor = me, pChar = pM;
  if (statsM > statsC) { ganador = me; gChar = pM; perdedor = challenger; pChar = pC; }
  else if (statsM === statsC) {
    if (Math.random() < 0.5) { ganador = challenger; gChar = pC; perdedor = me; pChar = pM; }
  }

  // Tope diario por usuario (batallaAnimeDiario)
  const hoy = hoyStr();
  function getRestante(u){
    u.batallaAnimeDiario = u.batallaAnimeDiario || { fecha: hoy, creditos: 0, xp: 0 };
    if (u.batallaAnimeDiario.fecha !== hoy) u.batallaAnimeDiario = { fecha: hoy, creditos: 0, xp: 0 };
    return {
      cred: Math.max(0, TOPE_CREDITOS_DIA - (u.batallaAnimeDiario.creditos||0)),
      xp:   Math.max(0, TOPE_XP_DIA      - (u.batallaAnimeDiario.xp||0))
    };
  }

  const rgC = { cred: rng(WIN_CRED_MIN, WIN_CRED_MAX), xp: rng(WIN_XP_MIN, WIN_XP_MAX) };
  const rlC = { cred: rng(LOSE_CRED_MIN, LOSE_CRED_MAX), xp: rng(LOSE_XP_MIN, LOSE_XP_MAX) };

  function aplicarRecompensas(u, p, base) {
    const rest = getRestante(u);
    const cred = Math.min(base.cred, rest.cred);
    const xp   = Math.min(base.xp,   rest.xp);

    u.creditos = (u.creditos||0) + cred;

    // subir personaje / habilidad (como luchar.js)
    p.xp += xp;
    let subio = false;
    let req = XP_PERSONAJE_BASE + (p.nivel * 25);
    while (p.xp >= req) {
      p.xp -= req;
      p.nivel += 1;
      subio = true;
      req = XP_PERSONAJE_BASE + (p.nivel * 25);
    }
    // una habilidad aleatoria
    let subHab = null;
    const idx = Math.random() < 0.5 ? 0 : 1;
    const h = p.habilidades[idx];
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

    // sumar al diario
    u.batallaAnimeDiario.creditos += cred;
    u.batallaAnimeDiario.xp += xp;

    return { cred, xp, subio, subHab };
  }

  const resG = aplicarRecompensas(ganador, gChar, rgC);
  const resP = aplicarRecompensas(perdedor, pChar, rlC);

  // limpiar solicitud
  delete challenger.battleRequest;

  save(db);

  // ✅ última EDICIÓN: ganador y perdedor con menciones y nombres de personajes
  await sleep(EDIT_DELAY);
  lastKey = await editOrSend(
    conn, chatId, lastKey,
`🏁 *Resultado de la Batalla Anime*
👑 Ganador: @${ganador.numero} — *${gChar.nombre || "Su personaje"}* (+${formatPts(resG.cred)} créditos, +${formatPts(resG.xp)} XP)
💤 Perdedor: @${perdedor.numero} — *${pChar.nombre || "Su personaje"}* (+${formatPts(resP.cred)} créditos, +${formatPts(resP.xp)} XP)`,
    [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`],
    msg
  );

  // Mensaje extra (subidas)
  let extra = "";
  if (resG.subio) extra += `\n🎉 *${gChar.nombre || "Su personaje"}* de @${ganador.numero} sube a *Nv ${gChar.nivel}*!`;
  if (resG.subHab) extra += `\n✨ Mejora de habilidad (ganador): ${resG.subHab}`;
  if (resP.subio) extra += `\n🎉 *${pChar.nombre || "Su personaje"}* de @${perdedor.numero} sube a *Nv ${pChar.nivel}*!`;
  if (resP.subHab) extra += `\n✨ Mejora de habilidad (perdedor): ${resP.subHab}`;

  if (extra) {
    await conn.sendMessage(
      chatId,
      { text: extra, mentions: [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`] },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["goani", "goper"];
export default handler;
