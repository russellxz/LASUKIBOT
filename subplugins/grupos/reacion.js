// plugins/reacion.js
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

async function resolveIdentity(conn, chatId, source, msg) {
  const raw = String(source || "");
  let realJid = null;
  let lidJid = null;

  const ids = [
    raw,
    msg?.realJid,
    msg?.realLid,
    msg?.key?.participant,
    msg?.key?.participantPn,
    msg?.key?.participantLid,
    msg?.key?.senderPn,
    msg?.key?.senderLid,
    msg?.key?.participantAlt,
    msg?.key?.senderAlt
  ].filter(Boolean);

  for (const id of ids) {
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
  const realNumber = msg?.realNumber ? DIGITS(msg.realNumber) : "";

  const keys = [];

  if (baseNumber) keys.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) keys.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) keys.push(lidNumber);
  if (realNumber) keys.push(realNumber);
  if (!keys.length && rawNumber) keys.push(rawNumber);

  return {
    raw,
    realJid,
    lidJid,
    baseNumber,
    zeroNumber,
    lidNumber,
    rawNumber,
    realNumber,
    keys: [...new Set(keys)]
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
      identity.realNumber,
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
      const isAdmin = p?.admin === "admin" || p?.admin === "superadmin";
      if (!isAdmin) continue;

      const adm = await resolveIdentity(conn, chatId, p.id || p.jid || p.lid || "", null);

      if (adm.keys.some(k => identity.keys.includes(k))) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const fromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo puede usarse en grupos.*"
    }, { quoted: msg });
  }

  const senderRaw = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderIdentity = await resolveIdentity(conn, chatId, senderRaw, msg);

  const isAdmin = await isAdminByIdentity(conn, chatId, senderIdentity);
  const isOwner = safeIsOwner(senderIdentity);

  if (!isAdmin && !isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
  }

  const estado = String(args[0] || "").toLowerCase();

  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, {
      text:
"✳️ *Usa correctamente:*\n\n" +
".reacion on\n" +
".reacion off"
    }, { quoted: msg });
  }

  let data = {};
  try {
    data = typeof conn.readSubData === "function"
      ? (conn.readSubData("activoss.json", {}) || {})
      : JSON.parse(fs.readFileSync(path.join(conn.subDataDir, "activoss.json"), "utf-8"));
  } catch {
    data = {};
  }

  data[chatId] = data[chatId] || {};
  data[chatId].reacion = estado;

  // Usar writeSubData para invalidar el caché del pipeline (efecto inmediato)
  if (typeof conn.writeSubData === "function") {
    conn.writeSubData("activoss.json", data);
  } else {
    fs.writeFileSync(path.join(conn.subDataDir, "activoss.json"), JSON.stringify(data, null, 2));
  }

  return conn.sendMessage(chatId, {
    text: `✅ Respuestas automáticas del subbot *${estado === "on" ? "activadas" : "desactivadas"}* en este grupo.`
  }, { quoted: msg });
};

handler.command = ["reacion", "reaccion"];
export default handler;
