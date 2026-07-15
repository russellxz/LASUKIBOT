// plugins/mute.js
import fs from 'fs';
import path from 'path';

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

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
  const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
  return n ? `${n}@s.whatsapp.net` : null;
}

function cleanLidJid(jid) {
  const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
  return n ? `${n}@lid` : null;
}

function safeIsOwner(value) {
  try {
    if (typeof global.isOwner !== "function") return false;

    const raw = String(value || "");
    const num = DIGITS(raw);

    if (raw && global.isOwner(raw)) return true;
    if (num && global.isOwner(num)) return true;

    return false;
  } catch {
    return false;
  }
}

function getContextInfo(msg) {
  const m = msg.message || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    null
  );
}

function getQuotedParticipant(ctx) {
  if (!ctx) return "";

  return (
    (isUser(ctx.participantPn) && ctx.participantPn) ||
    (isUser(ctx.participantAlt) && ctx.participantAlt) ||
    (isUser(ctx.senderPn) && ctx.senderPn) ||
    (isUser(ctx.senderAlt) && ctx.senderAlt) ||
    (typeof ctx.participant === "string" && ctx.participant) ||
    ""
  );
}

/** Verifica admin por número, PN o LID */
async function isAdminByNumber(conn, chatId, number) {
  try {
    const target = DIGITS(number);
    if (!target) return false;

    const meta = await conn.groupMetadata(chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

    const adminNums = new Set();

    for (const p of rawParts) {
      const isAdmin =
        p?.admin === "admin" ||
        p?.admin === "superadmin";

      if (!isAdmin) continue;

      const ids = [
        p?.id,
        p?.jid,
        p?.lid,
        p?.pn,
        p?.phoneNumber,
        p?.jidAlt
      ].filter(x => typeof x === "string");

      for (const jid of ids) {
        const d = DIGITS(jid);
        if (d) adminNums.add(d);

        if (isLid(jid)) {
          try {
            if (global.lidMap instanceof Map) {
              const mapped = global.lidMap.get(jid);
              if (mapped) {
                const md = DIGITS(mapped);
                if (md) adminNums.add(md);
              }
            }
          } catch {}

          try {
            const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(jid);
            if (isUser(pn)) {
              const pd = DIGITS(pn);
              if (pd) adminNums.add(pd);

              if (global.lidMap instanceof Map) {
                global.lidMap.set(jid, pn);
                global.lidMap.set(pn, jid);
              }
            }
          } catch {}
        }
      }

      try {
        if (typeof conn.lidParser === "function") {
          const parsed = conn.lidParser([p]);
          const nid = parsed?.[0]?.id;
          const nd = DIGITS(nid);
          if (nd) adminNums.add(nd);
        }
      } catch {}
    }

    return adminNums.has(target);
  } catch {
    return false;
  }
}

async function resolveLidFromPn(conn, chatId, pnJid) {
  try {
    pnJid = cleanUserJid(pnJid);
    if (!pnJid) return null;

    if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
      const lidCached = global.lidMap.get(pnJid);
      if (isLid(lidCached)) return cleanLidJid(lidCached);
    }

    try {
      const lid = await conn.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
      if (isLid(lid)) {
        const cleanLid = cleanLidJid(lid);

        if (global.lidMap instanceof Map) {
          global.lidMap.set(pnJid, cleanLid);
          global.lidMap.set(cleanLid, pnJid);
        }

        return cleanLid;
      }
    } catch {}

    if (chatId.endsWith("@g.us") && conn.groupMetadata) {
      const meta = await conn.groupMetadata(chatId);
      const participants = Array.isArray(meta?.participants) ? meta.participants : [];

      for (const p of participants) {
        const ids = [
          p?.id,
          p?.jid,
          p?.lid,
          p?.pn,
          p?.phoneNumber,
          p?.jidAlt
        ].filter(x => typeof x === "string");

        let real = null;
        let lidc = null;

        for (const id of ids) {
          if (isUser(id)) real = cleanUserJid(id);
          if (isLid(id)) lidc = cleanLidJid(id);
        }

        if (real === pnJid && lidc) {
          if (global.lidMap instanceof Map) {
            global.lidMap.set(pnJid, lidc);
            global.lidMap.set(lidc, pnJid);
          }

          return lidc;
        }
      }
    }
  } catch {}

  return null;
}

async function resolvePnFromLid(conn, chatId, lidJid) {
  try {
    lidJid = cleanLidJid(lidJid);
    if (!lidJid) return null;

    if (global.lidMap instanceof Map && global.lidMap.has(lidJid)) {
      const pnCached = global.lidMap.get(lidJid);
      if (isUser(pnCached)) return cleanUserJid(pnCached);
    }

    try {
      const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
      if (isUser(pn)) {
        const cleanPn = cleanUserJid(pn);

        if (global.lidMap instanceof Map) {
          global.lidMap.set(lidJid, cleanPn);
          global.lidMap.set(cleanPn, lidJid);
        }

        return cleanPn;
      }
    } catch {}

    try {
      if (global.resolveRealJidAsync) {
        const pn2 = await global.resolveRealJidAsync(lidJid);
        if (isUser(pn2)) {
          const cleanPn2 = cleanUserJid(pn2);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(lidJid, cleanPn2);
            global.lidMap.set(cleanPn2, lidJid);
          }

          return cleanPn2;
        }
      }
    } catch {}

    if (chatId.endsWith("@g.us") && conn.groupMetadata) {
      const meta = await conn.groupMetadata(chatId);
      const participants = Array.isArray(meta?.participants) ? meta.participants : [];

      for (const p of participants) {
        const ids = [
          p?.id,
          p?.jid,
          p?.lid,
          p?.pn,
          p?.phoneNumber,
          p?.jidAlt
        ].filter(x => typeof x === "string");

        let foundLid = null;
        let foundPn = null;

        for (const id of ids) {
          if (isLid(id)) foundLid = cleanLidJid(id);
          if (isUser(id)) foundPn = cleanUserJid(id);
        }

        if (foundLid === lidJid && foundPn) {
          if (global.lidMap instanceof Map) {
            global.lidMap.set(lidJid, foundPn);
            global.lidMap.set(foundPn, lidJid);
          }

          return foundPn;
        }
      }
    }
  } catch {}

  return null;
}

/** Resuelve objetivo igual que addowner: base, con 0 y LID */
async function resolveTarget(conn, chatId, anyJid) {
  const raw = String(anyJid || "");

  let realJid = null;
  let lidJid = null;

  let baseNumber = "";
  let zeroNumber = "";
  let lidNumber = "";

  if (isUser(raw)) {
    realJid = cleanUserJid(raw);
    baseNumber = DIGITS(realJid);
    zeroNumber = addZero(baseNumber);
  } else if (isLid(raw)) {
    lidJid = cleanLidJid(raw);
    lidNumber = DIGITS(lidJid);

    const pn = await resolvePnFromLid(conn, chatId, lidJid);
    if (pn) {
      realJid = cleanUserJid(pn);
      baseNumber = DIGITS(realJid);
      zeroNumber = addZero(baseNumber);
    }
  } else {
    baseNumber = DIGITS(raw);
    zeroNumber = addZero(baseNumber);
    if (baseNumber) realJid = `${baseNumber}@s.whatsapp.net`;
  }

  if (!lidJid && baseNumber) {
    const tryNumbers = [];
    tryNumbers.push(baseNumber);
    if (zeroNumber && zeroNumber !== baseNumber) tryNumbers.push(zeroNumber);

    for (const n of tryNumbers) {
      const found = await resolveLidFromPn(conn, chatId, `${n}@s.whatsapp.net`);
      if (found) {
        lidJid = found;
        lidNumber = DIGITS(found);
        break;
      }
    }
  }

  const numbersToSave = [];
  if (baseNumber) numbersToSave.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) numbersToSave.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) numbersToSave.push(lidNumber);

  return {
    raw,
    realJid,
    lidJid,
    baseNumber,
    zeroNumber,
    lidNumber,
    numbersToSave
  };
}

function isOwnerTarget(target) {
  const values = [
    target.raw,
    target.realJid,
    target.lidJid,
    target.baseNumber,
    target.zeroNumber,
    target.lidNumber
  ];

  return values.some(v => safeIsOwner(v));
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId));
  const fromMe = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo puede usarse en grupos.*"
    }, { quoted: msg });
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  const isOwner = safeIsOwner(senderId) || safeIsOwner(senderNo);

  if (!isAdmin && !isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
  }

  const ctx = getContextInfo(msg);
  const mentionedJids = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const replyJid = getQuotedParticipant(ctx);

  const rawTargets = new Set();
  if (replyJid) rawTargets.add(replyJid);
  mentionedJids.forEach(j => rawTargets.add(j));

  if (!rawTargets.size) {
    return conn.sendMessage(chatId, {
      text: "⚠️ *Responde o menciona a uno o más usuarios para mutear.*"
    }, { quoted: msg });
  }

  const welcomePath = path.join(conn.subDataDir, "setwelcome.json");
  const welcomeData = fs.existsSync(welcomePath)
    ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
    : {};

  welcomeData[chatId] = welcomeData[chatId] || {};
  welcomeData[chatId].muted = Array.isArray(welcomeData[chatId].muted)
    ? welcomeData[chatId].muted
    : [];

  // Convierte formatos viejos JID a solo números
  const mutedList = welcomeData[chatId].muted
    .map(x => DIGITS(x))
    .filter(Boolean);

  const mutedSet = new Set(mutedList);

  const nuevosLines = [];
  const yaLines = [];
  const protectedLines = [];
  const mentionSet = new Set();

  for (const anyJid of rawTargets) {
    const target = await resolveTarget(conn, chatId, anyJid);

    if (!target.numbersToSave.length) continue;

    const showNumber = target.baseNumber || target.lidNumber || DIGITS(anyJid);

    if (isOwnerTarget(target)) {
      protectedLines.push(`@${showNumber}`);
      continue;
    }

    const yaEsta = target.numbersToSave.some(n => mutedSet.has(n));

    if (yaEsta) {
      yaLines.push(`@${showNumber}`);
    } else {
      target.numbersToSave.forEach(n => mutedSet.add(n));
      nuevosLines.push(`@${showNumber}`);
    }

    if (target.realJid) mentionSet.add(target.realJid);
    else if (target.lidJid) mentionSet.add(target.lidJid);
    else if (target.baseNumber) mentionSet.add(`${target.baseNumber}@s.whatsapp.net`);
  }

  welcomeData[chatId].muted = [...mutedSet];
  fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));

  let texto = "";

  if (nuevosLines.length) {
    texto += `🔇 *Usuarios muteados correctamente:*\n${nuevosLines.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\n`;
  }

  if (yaLines.length) {
    texto += `⚠️ *Ya estaban muteados:*\n${yaLines.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\n`;
  }

  if (protectedLines.length) {
    texto += `🛡️ *No se pueden mutear owners:*\n${protectedLines.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n\n`;
  }

  if (!texto.trim()) texto = "ℹ️ *No se realizaron cambios.*";

  return conn.sendMessage(chatId, {
    text: texto.trim(),
    mentions: [...mentionSet]
  }, { quoted: msg });
};

handler.command = ["mute"];
export default handler;
