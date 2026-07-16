// plugins/gomascota.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const EDIT_DELAY = 1500;

const TOPE_CREDITOS_DIA = 9000;
const TOPE_XP_DIA = 10000;

const XP_MASCOTA_BASE = 120;
const XP_HAB_BASE = 60;

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
const format = (n)=> (n|0);

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
  try {
    const chatId = msg.key.remoteJid;
    const myJid = msg.key.participant || msg.key.remoteJid; // aceptante
    const myNum = toNum(myJid);

    await conn.sendMessage(chatId, { react: { text: "🎌", key: msg.key } });

    let db = load();
    db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
    const me = db.usuarios.find(u => u.numero === myNum);
    if (!me) return conn.sendMessage(chatId, { text: "❌ *No estás registrado en el RPG.*" }, { quoted: msg });

    // 1) Buscar desafío donde YO soy el RETADO
    let challenger = db.usuarios.find(u =>
      u.battleRequest &&
      u.battleRequest.type === "mascota" &&
      toNum(u.battleRequest.target) === myNum
    );

    // 2) Si no hay, verificar si YO soy el RETADOR y avisar correctamente
    if (!challenger) {
      if (me.battleRequest && me.battleRequest.type === "mascota") {
        const targetNum = toNum(me.battleRequest.target);
        const faltan = Math.max(0, 120000 - (Date.now() - me.battleRequest.time));
        const seg = Math.ceil(faltan / 1000);
        return conn.sendMessage(
          chatId,
          { text: `📨 *Ya enviaste un desafío de mascotas.*\nEl usuario +${targetNum} debe aceptar con *.${global?.prefix || ""}gomascota*.\n⏳ Expira en ~${seg}s.` },
          { quoted: msg }
        );
      }
      return conn.sendMessage(chatId, { text: "⚠️ *No tienes un desafío de mascotas pendiente.*" }, { quoted: msg });
    }

    // Expiración (2 min)
    if ((Date.now() - challenger.battleRequest.time) > 2*60*1000) {
      delete challenger.battleRequest;
      save(db);
      return conn.sendMessage(chatId, { text: "⏳ *La solicitud de batalla de mascotas ha expirado.*" }, { quoted: msg });
    }

    // Cooldown del aceptante
    me.cooldowns = me.cooldowns || {};
    if (me.cooldowns.batallaMascota && (Date.now() - me.cooldowns.batallaMascota) < COOLDOWN_MS) {
      const falt = Math.ceil((COOLDOWN_MS - (Date.now() - me.cooldowns.batallaMascota))/1000);
      return conn.sendMessage(chatId, { text: `⏳ *Debes esperar ${falt}s para aceptar batallas.*` }, { quoted: msg });
    }
    // Aplicar cooldown a ambos al iniciar
    challenger.cooldowns = challenger.cooldowns || {};
    challenger.cooldowns.batallaMascota = Date.now();
    me.cooldowns.batallaMascota = Date.now();

    // Asegurar mascotas
    const ensurePet = (u)=>{
      if (!Array.isArray(u.mascotas) || u.mascotas.length===0){
        u.mascotas=[{nombre:"Tu mascota",nivel:1,xp:0,habilidades:[{nombre:"Habilidad 1",nivel:1,xp:0},{nombre:"Habilidad 2",nivel:1,xp:0}]}];
      }
      const m=u.mascotas[0];
      m.nivel=m.nivel||1; m.xp=m.xp||0;
      m.habilidades = Array.isArray(m.habilidades)&&m.habilidades.length>=2 ? m.habilidades : [{nombre:"Habilidad 1",nivel:1,xp:0},{nombre:"Habilidad 2",nivel:1,xp:0}];
      for(const h of m.habilidades){ h.nivel=h.nivel||1; h.xp=h.xp||0; }
      return m;
    };

    const pC = ensurePet(challenger);
    const pM = ensurePet(me);

    // Animación con menciones (5 frames, 1.5s)
    const cTag = `${challenger.numero}@s.whatsapp.net`;
    const mTag = `${me.numero}@s.whatsapp.net`;
    const mentions = [cTag, mTag];

    let sent = await conn.sendMessage(
      chatId,
      { text: `🎌 *¡Batalla de Mascotas!* — @${challenger.numero} — *${pC.nombre || "A"}* vs @${me.numero} — *${pM.nombre || "B"}*\n\n¡Comienza el duelo!`, mentions },
      { quoted: msg }
    );
    let lastKey = sent?.key;

    const frames = [
      `🐾 *${pC.nombre || "A"}* salta al ataque, *${pM.nombre || "B"}* esquiva con agilidad.`,
      `🦴 *${pM.nombre || "B"}* responde con combo, *${pC.nombre || "A"}* bloquea a tiempo.`,
      `💥 Choque feroz: garras y colmillos ¡vuelan chispas!`,
      `🛡️ *${pC.nombre || "A"}* usa su técnica; *${pM.nombre || "B"}* contraataca.`,
      `🌪️ ¡Ataque final! El polvo se asienta…`
    ];
    for (const f of frames) {
      await sleep(EDIT_DELAY);
      lastKey = await editOrSend(
        conn, chatId, lastKey,
        `🎌 *Batalla de Mascotas*\n@${challenger.numero} — *${pC.nombre || "A"}* vs @${me.numero} — *${pM.nombre || "B"}*\n\n${f}`,
        mentions,
        msg
      );
    }

    // Determinar ganador (stats)
    const statsC = (pC.nivel||1)*5 + (pC.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);
    const statsM = (pM.nivel||1)*5 + (pM.habilidades||[]).reduce((t,h)=>t+(h.nivel||1)*2,0);

    let ganador = challenger, gPet = pC, perdedor = me, pPet = pM;
    if (statsM > statsC) { ganador = me; gPet = pM; perdedor = challenger; pPet = pC; }
    else if (statsM === statsC && Math.random() < 0.5) { ganador = challenger; gPet = pC; perdedor = me; pPet = pM; }

    // Topes diarios por usuario
    const hoy = hoyStr();
    function restante(u){
      u.batallaMascotaDiario = u.batallaMascotaDiario || { fecha: hoy, creditos: 0, xp: 0 };
      if (u.batallaMascotaDiario.fecha !== hoy) u.batallaMascotaDiario = { fecha: hoy, creditos: 0, xp: 0 };
      return {
        cred: Math.max(0, TOPE_CREDITOS_DIA - (u.batallaMascotaDiario.creditos||0)),
        xp:   Math.max(0, TOPE_XP_DIA      - (u.batallaMascotaDiario.xp||0)),
      };
    }

    // Recompensas
    const rewG = { cred: rng(WIN_CRED_MIN, WIN_CRED_MAX),  xp: rng(WIN_XP_MIN, WIN_XP_MAX) };
    const rewP = { cred: rng(LOSE_CRED_MIN, LOSE_CRED_MAX), xp: rng(LOSE_XP_MIN, LOSE_XP_MAX) };

    function applyRewards(u, pet, base) {
      const rest = restante(u);
      const cred = Math.min(base.cred, rest.cred);
      const xp   = Math.min(base.xp,   rest.xp);

      u.creditos = (u.creditos || 0) + cred;

      // subir mascota
      pet.xp += xp;
      let subio = false;
      let req = XP_MASCOTA_BASE + (pet.nivel * 25);
      while (pet.xp >= req) {
        pet.xp -= req;
        pet.nivel += 1;
        subio = true;
        req = XP_MASCOTA_BASE + (pet.nivel * 25);
      }
      // habilidad aleatoria
      let subHab = null;
      const idx = Math.random() < 0.5 ? 0 : 1;
      const h = pet.habilidades[idx] || (pet.habilidades[idx] = { nombre: `Habilidad ${idx+1}`, nivel: 1, xp: 0 });
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
      u.batallaMascotaDiario.creditos += cred;
      u.batallaMascotaDiario.xp += xp;

      return { cred, xp, subio, subHab };
    }

    const resG = applyRewards(ganador, gPet, rewG);
    const resP = applyRewards(perdedor, pPet, rewP);

    // limpiar solicitud
    delete challenger.battleRequest;
    save(db);

    // Última edición con resultado
    await sleep(EDIT_DELAY);
    await editOrSend(
      conn, chatId, lastKey,
`🏁 *Resultado: Batalla de Mascotas*
👑 Ganador: @${ganador.numero} — *${gPet.nombre || "Su mascota"}* (+${format(resG.cred)} créditos, +${format(resG.xp)} XP)
💤 Perdedor: @${perdedor.numero} — *${pPet.nombre || "Su mascota"}* (+${format(resP.cred)} créditos, +${format(resP.xp)} XP)`,
      [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`],
      msg
    );

    // Subidas
    let extra = "";
    if (resG.subio) extra += `\n🎉 *${gPet.nombre || "Su mascota"}* de @${ganador.numero} sube a *Nv ${gPet.nivel}*!`;
    if (resG.subHab) extra += `\n✨ Habilidad mejorada (ganador): ${resG.subHab}`;
    if (resP.subio) extra += `\n🎉 *${pPet.nombre || "Su mascota"}* de @${perdedor.numero} sube a *Nv ${pPet.nivel}*!`;
    if (resP.subHab) extra += `\n✨ Habilidad mejorada (perdedor): ${resP.subHab}`;

    if (extra) {
      await conn.sendMessage(
        chatId,
        { text: extra, mentions: [`${ganador.numero}@s.whatsapp.net`, `${perdedor.numero}@s.whatsapp.net`] },
        { quoted: msg }
      );
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    console.error("❌ Error en gomascota:", e);
    try {
      await conn.sendMessage(msg.key.remoteJid, { text: "❌ Ocurrió un error al procesar la batalla de mascotas." }, { quoted: msg });
    } catch {}
  }
};

handler.command = ["gomascota", "gomas"];
export default handler;
