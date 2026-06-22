import fs from 'fs';
import path from 'path';

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

function isUser(j) {
  return typeof j === "string" && j.endsWith("@s.whatsapp.net");
}

function isLid(j) {
  return typeof j === "string" && j.endsWith("@lid");
}

function addZero(n) {
  const clean = DIGITS(n);
  if (!clean) return "";
  return clean.endsWith("0") ? clean : clean + "0";
}

function cleanUserJid(jid) {
  const n = JID_NUM(jid);
  return n ? `${n}@s.whatsapp.net` : null;
}

function cleanLidJid(jid) {
  const n = JID_NUM(jid);
  return n ? `${n}@lid` : null;
}

function normalizeChatCount(chatCount = {}) {
  const out = {};

  for (const [key, val] of Object.entries(chatCount || {})) {
    const d = JID_NUM(key) || DIGITS(key);
    const n = Number(val || 0);

    if (!d || Number.isNaN(n)) continue;
    if (!out[d] || n > out[d]) out[d] = n;
  }

  return out;
}

async function resolveIdentity(conn, chatId, source) {
  const ids = [];
  let raw = "";

  if (typeof source === "string") {
    raw = source;
    ids.push(source);
  } else if (source && typeof source === "object") {
    raw = source.id || source.jid || source.lid || "";
    ids.push(source.id, source.jid, source.lid, source.pn, source.phoneNumber, source.jidAlt);
  }

  let realJid = null;
  let lidJid = null;

  for (const id of ids.filter(Boolean)) {
    if (isUser(id)) realJid = cleanUserJid(id);
    if (isLid(id)) lidJid = cleanLidJid(id);
  }

  try {
    if (global.lidMap instanceof Map) {
      if (lidJid && !realJid) {
        const pn = global.lidMap.get(lidJid);
        if (isUser(pn)) realJid = cleanUserJid(pn);
      }

      if (realJid && !lidJid) {
        const lid = global.lidMap.get(realJid);
        if (isLid(lid)) lidJid = cleanLidJid(lid);
      }
    }
  } catch {}

  try {
    if (lidJid && !realJid) {
      const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
      if (isUser(pn)) {
        realJid = cleanUserJid(pn);

        if (global.lidMap instanceof Map) {
          global.lidMap.set(lidJid, realJid);
          global.lidMap.set(realJid, lidJid);
        }
      }
    }
  } catch {}

  try {
    if (realJid && !lidJid) {
      const lid = await conn.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
      if (isLid(lid)) {
        lidJid = cleanLidJid(lid);

        if (global.lidMap instanceof Map) {
          global.lidMap.set(realJid, lidJid);
          global.lidMap.set(lidJid, realJid);
        }
      }
    }
  } catch {}

  const baseNumber = realJid ? JID_NUM(realJid) : "";
  const zeroNumber = baseNumber ? addZero(baseNumber) : "";
  const lidNumber = lidJid ? JID_NUM(lidJid) : "";
  const rawNumber = JID_NUM(raw);

  const keys = [];

  if (baseNumber) keys.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) keys.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) keys.push(lidNumber);
  if (!keys.length && rawNumber) keys.push(rawNumber);

  const mentionJid = realJid || lidJid || (rawNumber ? `${rawNumber}@s.whatsapp.net` : null) || raw || null;
  const mentionTag = JID_NUM(mentionJid);

  return {
    raw,
    realJid,
    lidJid,
    baseNumber,
    zeroNumber,
    lidNumber,
    rawNumber,
    keys,
    mentionJid,
    mentionTag,
    showNumber: mentionTag || baseNumber || lidNumber || rawNumber || "usuario",
    isLidOnly: !realJid && !!lidJid
  };
}

function safeIsOwner(identity) {
  try {
    if (!identity) return false;

    const values = [
      identity.raw,
      identity.realJid,
      identity.lidJid,
      identity.baseNumber,
      identity.zeroNumber,
      identity.lidNumber,
      identity.rawNumber,
      ...identity.keys
    ].filter(Boolean);

    if (typeof global.isOwner === "function") {
      for (const v of values) {
        if (global.isOwner(v)) return true;
      }
    }

    if (Array.isArray(global.owner)) {
      const ownerNums = new Set();

      for (const entry of global.owner) {
        if (Array.isArray(entry)) {
          for (const x of entry) {
            const d = JID_NUM(x) || DIGITS(x);
            if (d) ownerNums.add(d);
          }
        } else {
          const d = JID_NUM(entry) || DIGITS(entry);
          if (d) ownerNums.add(d);
        }
      }

      return values.some(v => ownerNums.has(JID_NUM(v) || DIGITS(v)));
    }

    return false;
  } catch {
    return false;
  }
}

async function isAdminByIdentity(conn, chatId, identity) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];

    for (const p of participants) {
      const admin = p?.admin === "admin" || p?.admin === "superadmin";
      if (!admin) continue;

      const adm = await resolveIdentity(conn, chatId, p);
      if (adm.keys.some(k => identity.keys.includes(k))) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function getCountForIdentity(normalizedCount, identity) {
  let max = 0;

  for (const key of identity.keys) {
    const val = Number(normalizedCount[key] || 0);
    if (val > max) max = val;
  }

  return max;
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const fromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo se puede usar en grupos.*"
    }, { quoted: msg });
  }

  const senderRaw = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderIdentity = await resolveIdentity(conn, chatId, senderRaw);

  const isAdmin = await isAdminByIdentity(conn, chatId, senderIdentity);
  const isOwner = safeIsOwner(senderIdentity);

  if (!isAdmin && !isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
  }

  const limite = parseInt(args[0]);

  if (Number.isNaN(limite)) {
    return conn.sendMessage(chatId, {
      text: "❓ *Debes escribir un número de mensajes para detectar fantasmas.*\n\nEjemplo: `.fantasmas 10`"
    }, { quoted: msg });
  }

  const filePath = path.resolve("setwelcome.json");
  const data = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
    : {};

  const chatCount = data[chatId]?.chatCount || {};
  const normalizedCount = normalizeChatCount(chatCount);

  const metadata = await conn.groupMetadata(chatId);
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];

  const botNumber = JID_NUM(conn.user?.id || "");
  const fantasmas = [];
  const mentions = [];

  for (const p of participants) {
    const identity = await resolveIdentity(conn, chatId, p);

    if (!identity.mentionJid && !identity.showNumber) continue;

    const isParticipantAdmin = p?.admin === "admin" || p?.admin === "superadmin";
    const isParticipantOwner = safeIsOwner(identity);
    const isBot = identity.keys.some(k => k === botNumber);

    if (isParticipantAdmin || isParticipantOwner || isBot) continue;

    const count = getCountForIdentity(normalizedCount, identity);

    if (count < limite) {
      fantasmas.push({
        mentionJid: identity.mentionJid,
        mentionTag: identity.showNumber,
        count,
        isLidOnly: identity.isLidOnly
      });

      if (identity.mentionJid) mentions.push(identity.mentionJid);
    }
  }

  const advertencia =
`⚠️ *Advertencia Importante*
Este conteo solo se basa en los mensajes detectados desde que *La Suki Bot* fue agregada al grupo.
No refleja actividad real de todo el historial del grupo.

No se incluyen admins, owners ni el bot.

`;

  if (!fantasmas.length) {
    return conn.sendMessage(chatId, {
      text: `✅ *No hay fantasmas con menos de ${limite} mensajes.*`
    }, { quoted: msg });
  }

  const listado = fantasmas
    .map((u, i) => `│ ${i + 1}. @${u.mentionTag} — *${u.count}* mensajes`)
    .join("\n");

  const texto =
`${advertencia}👻 *Fantasmas detectados:* ${fantasmas.length}
📝 *Menos de ${limite} mensajes:*

╭───────────────◆
${listado}
╰───────────────◆

🗑️ Usa *.fankick ${limite}* para eliminar automáticamente a estos inactivos.`;

  return conn.sendMessage(chatId, {
    text: texto,
    mentions: [...new Set(mentions)]
  }, { quoted: msg });
};

handler.command = ["fantasmas"];
export default handler;
      
