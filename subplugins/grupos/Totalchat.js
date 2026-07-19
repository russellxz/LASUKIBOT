// plugins/totalchat.js
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

  // CLAVE PARA QUE LA MENCIÓN SALGA AZUL:
  // En grupos LID, normalmente se debe mencionar con p.id, aunque el número real exista.
  const mentionJid = raw || lidJid || realJid;
  const mentionTag = JID_NUM(mentionJid);

  return {
    raw,
    realJid,
    lidJid,
    baseNumber,
    zeroNumber,
    lidNumber,
    rawNumber,
    keys: [...new Set(keys)],
    mentionJid,
    mentionTag,
    showNumber: mentionTag || baseNumber || lidNumber || rawNumber || "usuario"
  };
}

function getCountForIdentity(normalizedCount, identity) {
  let max = 0;

  for (const key of identity.keys) {
    const val = Number(normalizedCount[key] || 0);
    if (val > max) max = val;
  }

  return max;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo funciona en grupos.*"
    }, { quoted: msg });
  }

  // Volcar el conteo pendiente en memoria al archivo antes de leer
  try { conn.flushChatCounts?.(); } catch {}

  const filePath = path.join(conn.subDataDir, "setwelcome.json");

  if (!fs.existsSync(filePath)) {
    return conn.sendMessage(chatId, {
      text: "📊 *Aún no hay registros de mensajes en este grupo.*"
    }, { quoted: msg });
  }

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    data = {};
  }

  const chatData = data[chatId];

  if (!chatData?.chatCount || Object.keys(chatData.chatCount).length === 0) {
    return conn.sendMessage(chatId, {
      text: "📊 *Este grupo aún no tiene mensajes registrados.*"
    }, { quoted: msg });
  }

  const normalizedCount = normalizeChatCount(chatData.chatCount);

  const metadata = await conn.groupMetadata(chatId);
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];

  const rows = [];
  const mentions = [];

  for (const p of participants) {
    const identity = await resolveIdentity(conn, chatId, p);
    const count = getCountForIdentity(normalizedCount, identity);

    rows.push({
      mentionJid: identity.mentionJid,
      mentionTag: identity.mentionTag,
      count
    });

    if (identity.mentionJid) mentions.push(identity.mentionJid);
  }

  rows.sort((a, b) => b.count - a.count);

  const totalMsgs = rows.reduce((acc, x) => acc + x.count, 0);
  const activos = rows.filter(x => x.count > 0).length;

  const medallas = ["🥇", "🥈", "🥉"];

  const ranking = rows
    .map((u, i) => {
      const icon = medallas[i] || `${i + 1}.`;
      return `${icon} @${u.mentionTag} — *${u.count}* mensajes`;
    })
    .join("\n");

  const texto =
`📊 *Ranking de actividad del grupo*

👥 Miembros: *${rows.length}*
🟢 Activos registrados: *${activos}*
💬 Total contado: *${totalMsgs}* mensajes

${ranking}`;

  return conn.sendMessage(chatId, {
    text: texto,
    mentions: [...new Set(mentions)]
  }, { quoted: msg });
};

handler.command = ["totalchat"];
export default handler;
