// plugins/quitaradmins.js
import fs from 'fs';
import path from 'path';

// ✅ Patrón seguro para extraer solo números
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** Verifica admin por NÚMERO usando la lógica robusta (LID y no-LID) */
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

      // 1) Extracción directa de @s.whatsapp.net
      if (pid.endsWith("@s.whatsapp.net")) adminNums.add(pid.split(":")[0].replace(/[^0-9]/g, ""));
      if (pjid.endsWith("@s.whatsapp.net")) adminNums.add(pjid.split(":")[0].replace(/[^0-9]/g, ""));

      // 2) Resolución a través del lidMap
      if (pid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved = global.lidMap.get(pid);
        if (resolved && resolved.endsWith("@s.whatsapp.net")) adminNums.add(resolved.split(":")[0].replace(/[^0-9]/g, ""));
      }
      if (pjid.endsWith("@lid") && global.lidMap instanceof Map) {
        let resolved2 = global.lidMap.get(pjid);
        if (resolved2 && resolved2.endsWith("@s.whatsapp.net")) adminNums.add(resolved2.split(":")[0].replace(/[^0-9]/g, ""));
      }

      // 3) Fallback usando conn.lidParser (si existe)
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

/** Convierte una lista de JIDs (posible @lid) a JIDs reales @s.whatsapp.net */
async function mapJidsToReal(conn, chatId, jids = []) {
  const out = [];
  try {
    const meta = await conn.groupMetadata(chatId);
    const raw  = Array.isArray(meta?.participants) ? meta.participants : [];

    for (const jid of jids) {
      if (typeof jid !== "string") continue;
      if (jid.endsWith("@s.whatsapp.net")) { out.push(jid); continue; }
      
      if (jid.endsWith("@lid")) {
        // Resolver LID a través de metadata o lidMap
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
      
      // si no se pudo resolver, empuja tal cual (último recurso)
      out.push(jid);
    }
  } catch {
    return jids;
  }
  return Array.from(new Set(out)); // dedup
}

const handler = async (msg, { conn }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  
  // ✅ Obtener senderNo de forma robusta
  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
  
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo puede usarse en grupos.*" }, { quoted: msg });
    return;
  }

  // Permisos: admin (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  // Owners desde owner.json (fallback a global.owner) + validación robusta
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

  // Objetivos: menciones o respuesta
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const replied   = ctx?.participant ? [ctx.participant] : [];
  let targets     = [...mentioned, ...replied];

  if (!targets.length) {
    await conn.sendMessage(chatId, {
      text: "📌 *Debes mencionar o citar al usuario que quieres quitar como administrador.*"
    }, { quoted: msg });
    return;
  }

  // Resolver objetivos a JIDs reales (LID → real)
  const realTargets = await mapJidsToReal(conn, chatId, targets);

  // Cargar metadata para revisar creador del grupo
  let meta = {};
  try { meta = await conn.groupMetadata(chatId); } catch {}
  
  const creatorNum = meta?.owner ? DIGITS(meta.owner) : null;
  const botNum = conn.user?.id ? DIGITS(conn.user.id.split(":")[0]) : null;

  const toDemote = [];
  const notAdmin = [];
  const protectedOnes = [];

  for (const jid of realTargets) {
    const d = DIGITS(jid);
    
    // Validar protecciones
    let isProtected = false;
    if (d === botNum) isProtected = true; // Proteger al bot
    if (creatorNum && d === creatorNum) isProtected = true; // Proteger al creador del grupo
    if (Array.isArray(owners) && owners.some(e => String(Array.isArray(e) ? e[0] : e).replace(/[^0-9]/g, "") === d)) {
      isProtected = true; // Proteger al owner global
    }

    if (isProtected) { 
      protectedOnes.push(jid); 
      continue; 
    }

    // Validar si es admin usando el método robusto
    const targetIsAdmin = await isAdminByNumber(conn, chatId, d);
    
    if (!targetIsAdmin) { 
      notAdmin.push(jid); 
      continue; 
    }
    
    toDemote.push(jid);
  }

  // Ejecutar demote
  let ok = [];
  let fail = [];
  if (toDemote.length) {
    try {
      await conn.groupParticipantsUpdate(chatId, toDemote, "demote");
      ok = toDemote;
    } catch (e) {
      console.error("❌ Error al quitar admin:", e);
      fail = toDemote;
    }
  }

  // Resumen
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

// ✅ Variante "demote" añadida
handler.command = ["quitaradmins", "demote"];
export default handler;
