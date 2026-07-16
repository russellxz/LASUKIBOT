// plugins/batallauser.js
import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 7 * 60 * 1000;
const FILE = path.join(process.cwd(), "sukirpg.json");

const load = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf-8")) : { usuarios: [] };
const save = (db) => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
const toNum = (j) => String(j || "").replace(/\D/g, "");

const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;
  const myJid = msg.key.participant || msg.key.remoteJid;
  const myNum = toNum(myJid);

  await conn.sendMessage(chatId, { react: { text: "🧍‍♂️", key: msg.key } });

  let db = load(); db.usuarios = db.usuarios || [];
  const me = db.usuarios.find(u => u.numero === myNum);
  if (!me) return conn.sendMessage(chatId, { text: "❌ *No estás registrado en el RPG.*" }, { quoted: msg });

  // Cooldown (retador)
  me.cooldowns = me.cooldowns || {};
  if (me.cooldowns.batallaUser && (Date.now() - me.cooldowns.batallaUser) < COOLDOWN_MS) {
    const falt = Math.ceil((COOLDOWN_MS - (Date.now() - me.cooldowns.batallaUser))/1000);
    return conn.sendMessage(chatId, { text: `⏳ *Debes esperar ${falt}s para retar otra batalla de usuarios.*` }, { quoted: msg });
  }

  // Oponente por cita o mención
  let opponentJid = null;
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (ctx?.quotedMessage) opponentJid = ctx.participant;
  if (!opponentJid && ctx?.mentionedJid?.length) opponentJid = ctx.mentionedJid[0];
  if (!opponentJid) {
    return conn.sendMessage(chatId, { text: "⚔️ *Menciona o responde a un usuario para retarlo (usuarios).*" }, { quoted: msg });
  }
  const oppNum = toNum(opponentJid);

  const opp = db.usuarios.find(u => u.numero === oppNum);
  if (!opp) {
    return conn.sendMessage(chatId, { text: "❌ *El oponente no está registrado en el RPG.*" }, { quoted: msg });
  }

  // Asegurar estructura de habilidades de ambos usuarios
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
  ensureUser(me);
  ensureUser(opp);

  const nombreRetador = `${me.nombre||""} ${me.apellido||""}`.trim() || me.numero;
  const nombreRetado  = `${opp.nombre||""} ${opp.apellido||""}`.trim() || opp.numero;

  const text =
`🎌 *¡Desafío de Batalla entre Usuarios!* 🎌

👤 Retador: @${me.numero} — *${nombreRetador}*
🎯 Retado: @${opp.numero} — *${nombreRetado}*

🛡️ @${opp.numero}, responde con *.${global?.prefix || ""}gouser* para aceptar.
⏳ *Tienes 2 minutos para aceptar.*`;

  await conn.sendMessage(chatId, {
    text,
    mentions: [`${me.numero}@s.whatsapp.net`, `${opp.numero}@s.whatsapp.net`]
  }, { quoted: msg });

  // Guardar solicitud
  me.battleRequest = { target: oppNum, time: Date.now(), type: "user" };
  me.cooldowns.batallaUser = Date.now();
  save(db);

  // Expira en 2 minutos
  setTimeout(() => {
    try {
      const db2 = load();
      const me2 = db2.usuarios.find(u => u.numero === myNum);
      if (me2?.battleRequest &&
          me2.battleRequest.type === "user" &&
          toNum(me2.battleRequest.target) === oppNum) {
        delete me2.battleRequest;
        save(db2);
        conn.sendMessage(chatId, { text: "⏳ *La solicitud de batalla de usuarios expiró.*" }, { quoted: msg });
      }
    } catch {}
  }, 120000);
};

handler.command = ["batallauser"];
export default handler;
