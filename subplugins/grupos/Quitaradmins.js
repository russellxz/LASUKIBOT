import fs from 'fs';
import path from 'path';
import { isAdminInGroup } from '../../libs/adminCheck.js';

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

    const adminNums = new Set();
    for (let i = 0; i < rawParts.length; i++) {
      let p = rawParts[i];
      let flagAdmin = p.admin === "admin" || p.admin === "superadmin";
      if (!flagAdmin) continue;

      let pid  = String(p.id  || "");
      let pjid = String(p.jid || "");

      if (pid.endsWith("@s.whatsapp.net")) adminNums.add(pid.split(":")[0].replace(/[^0-9]/g, ""));
      if (pjid.endsWith("@s.whatsapp.net")) adminNums.add(pjid.split(":")[0].replace(/[^0-9]/g, ""));

      if (pid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved = global.lidMap.get(pid);
        if (resolved && resolved.endsWith("@s.whatsapp.net")) adminNums.add(resolved.split(":")[0].replace(/[^0-9]/g, ""));
      }
      if (pjid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved2 = global.lidMap.get(pjid);
        if (resolved2 && resolved2.endsWith("@s.whatsapp.net")) adminNums.add(resolved2.split(":")[0].replace(/[^0-9]/g, ""));
      }

      if (typeof conn.lidParser === "function") {
        let normed = conn.lidParser([p]);
        if (normed && normed[0]) {
          let nid = String(normed[0].id || "");
          if (nid.endsWith("@s.whatsapp.net")) adminNums.add(nid.split(":")[0].replace(/[^0-9]/g, ""));
        }
      }
    }
    return adminNums.has(number);
  } catch (e) {
    console.error("[quitaradmins] Error reading admins:", e);
    return false;
  }
}

async function mapJidsToReal(conn, chatId, jids = []) {
  const out = [];
  try {
    const meta = await conn.groupMetadata(chatId);
    const raw  = Array.isArray(meta?.participants) ? meta.participants : [];

    for (const jid of jids) {
      if (typeof jid !== "string") continue;
      if (jid.endsWith("@s.whatsapp.net")) { out.push(jid); continue; }
      
      if (jid.endsWith("@lid")) {
        let resolved = null;
        const pInfo = raw.find(p => p.id === jid);
        
        if (pInfo && pInfo.jid && pInfo.jid.endsWith("@s.whatsapp.net")) {
          resolved = pInfo.jid;
        } else if (global.lidMap instanceof Map && global.lidMap.has(jid)) {
          let mapped = global.lidMap.get(jid);
          if (mapped && mapped.endsWith("@s.whatsapp.net")) resolved = mapped;
        }

        if (resolved) { out.push(resolved); continue; }
      }
      
      out.push(jid);
    }
  } catch {
    return jids;
  }
  return Array.from(new Set(out));
}

const handler = async (msg, { conn }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo puede usarse en grupos.*" }, { quoted: msg });
    return;
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath)
    ? JSON.parse(fs.readFileSync(ownerPath, "utf-8"))
    : (global.owner || []);
    
  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores o dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
    return;
  }

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const replied   = ctx?.participant ? [ctx.participant] : [];
  let targets     = Array.from(new Set([...mentioned, ...replied]));

  if (!targets.length) {
    await conn.sendMessage(chatId, {
      text: "📌 *Debes mencionar o citar al usuario que quieres quitar como administrador.*"
    }, { quoted: msg });
    return;
  }

  let meta = {};
  try { meta = await conn.groupMetadata(chatId); } catch {}
  
  const creatorNum = meta?.owner ? DIGITS(meta.owner) : null;
  const botNum = conn.user?.id ? DIGITS(conn.user.id.split(":")[0]) : null;

  const toDemote = [];
  const protectedOnes = [];

  for (const jid of targets) {
    const d = DIGITS(jid);
    
    let isProtected = false;
    if (d === botNum) isProtected = true;
    if (creatorNum && d === creatorNum) isProtected = true;
    if (Array.isArray(owners) && owners.some(e => String(Array.isArray(e) ? e[0] : e).replace(/[^0-9]/g, "") === d)) {
      isProtected = true;
    }

    if (isProtected) { 
      protectedOnes.push(jid); 
      continue; 
    }

    toDemote.push(jid);
  }

  let ok = [];
  let notAdmin = [];
  let fail = [];

  for (const jid of toDemote) {
    const wasAdmin = await isAdminInGroup(conn, chatId, jid);

    const [realJid] = await mapJidsToReal(conn, chatId, [jid]);
    const apiTarget = realJid || jid;

    try {
      await conn.groupParticipantsUpdate(chatId, [apiTarget], "demote");
    } catch (e) {
      console.error("❌ Error al quitar admin:", e);
    }

    const stillAdmin = await isAdminInGroup(conn, chatId, jid);

    if (stillAdmin) {
      fail.push(jid);
    } else if (!wasAdmin) {
      notAdmin.push(jid);
    } else {
      ok.push(jid);
    }
  }

  const tag = (jid) => `@${DIGITS(jid)}`;
  const lines = [];
  if (ok.length)            lines.push(`✅ *Se quitó admin a:* ${ok.map(tag).join(", ")}`);
  if (notAdmin.length)      lines.push(`ℹ️ *No eran admin:* ${notAdmin.map(tag).join(", ")}`);
  if (protectedOnes.length) lines.push(`🛡️ *Protegidos (no se quita):* ${protectedOnes.map(tag).join(", ")}`);
  if (fail.length)          lines.push(`❌ *No se pudo quitar admin a:* ${fail.map(tag).join(", ")}`);

  await conn.sendMessage(chatId, {
    text: lines.join("\n"),
    mentions: [...ok, ...notAdmin, ...protectedOnes, ...fail]
  }, { quoted: msg });
};

handler.command = ["quitaradmins", "demote"];
export default handler;
