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

  return {
    raw,
    realJid,
    lidJid,
    baseNumber,
    zeroNumber,
    lidNumber,
    rawNumber,
    keys: [...new Set(keys)]
  };
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

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo puede usarse en grupos.*"
    }, { quoted: msg });
  }

  const senderRaw = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderIdentity = await resolveIdentity(conn, chatId, senderRaw);

  const isAdmin = await isAdminByIdentity(conn, chatId, senderIdentity);
  const isOwner = safeIsOwner(senderIdentity);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
  }

  const filePath = path.join(conn.subDataDir, "setwelcome.json");

  if (!fs.existsSync(filePath)) {
    return conn.sendMessage(chatId, {
      text: "❌ *No hay datos para este grupo.*"
    }, { quoted: msg });
  }

  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    data = {};
  }

  if (data[chatId]?.chatCount) {
    delete data[chatId].chatCount;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return conn.sendMessage(chatId, {
      text: "♻️ *El conteo de mensajes fue reiniciado en este grupo.*"
    }, { quoted: msg });
  }

  return conn.sendMessage(chatId, {
    text: "ℹ️ *Este grupo no tiene conteo de mensajes guardado.*"
  }, { quoted: msg });
};

handler.command = ["restchat"];
export default handler;
