// plugins/kick.js
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
    console.error("[kick] Error reading admins:", e);
    return false;
  }
}

/** Busca un participante por dígitos (coincide por p.id o p.jid o usando lidMap global) */
function findParticipantByDigits(parts = [], digits = "") {
  if (!digits) return null;
  for (const p of parts) {
    if (DIGITS(p?.id || "") === digits) return p;
    if (DIGITS(p?.jid || "") === digits) return p;
    
    // Soporte LID global por si la metadata solo tiene el @lid
    if (typeof p?.id === "string" && p.id.endsWith("@lid") && global.lidMap instanceof Map) {
      const resolved = global.lidMap.get(p.id);
      if (resolved && DIGITS(resolved) === digits) return p;
    }
  }
  return null;
}

const handler = async (msg, { conn }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  const isFromMe = !!msg.key.fromMe;

  // ✅ Obtener senderNum de forma robusta
  const senderRaw = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNum = String(msg.realNumber || DIGITS(senderRaw.split(":")[0]));

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo funciona en grupos.*" }, { quoted: msg });
    return;
  }

  // Permisos: admin (LID-aware robusto)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);

  // Owners y bot
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath, "utf-8")) : (global.owner || []);
  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNum;
  });

  const botRaw = conn.user?.id || "";
  const botNum = DIGITS(botRaw.split(":")[0]);
  const isBot  = botNum === senderNum;

  if (!isAdmin && !isOwner && !isBot && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores u owners pueden usar este comando.*"
    }, { quoted: msg });
    return;
  }

  let metadata;
  try {
    metadata = await conn.groupMetadata(chatId);
  } catch (e) {
    console.error("[kick] metadata error:", e);
    await conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
    return;
  }

  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

  // Obtener mencionados o citado
  const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
  const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  const quotedJid = ctx.participant || null;

  // Construir candidatos (por dígitos), de-duplicados
  const targetDigits = new Set(
    [
      ...mentioned.map(j => DIGITS(j)),
      quotedJid ? DIGITS(quotedJid) : ""
    ].filter(Boolean)
  );

  if (targetDigits.size === 0) {
    await conn.sendMessage(chatId, {
      text: "📌 *Debes mencionar o responder al mensaje del usuario que deseas expulsar.*\n\nEjemplo: *.kick @usuario* o responde a su mensaje con *.kick*"
    }, { quoted: msg });
    return;
  }

  const resultados = [];
  const mentionsOut = []; // para @menciones en el resumen
  for (const d of targetDigits) {
    // No te permitas expulsarte a ti ni al bot
    if (d === senderNum) {
      resultados.push(`⚠️ No puedes expulsarte a ti mismo (@${d}).`);
      mentionsOut.push(`${d}@s.whatsapp.net`);
      continue;
    }
    if (d === botNum) {
      resultados.push(`⚠️ No puedo expulsarme a mí (@${d}).`);
      mentionsOut.push(`${d}@s.whatsapp.net`);
      continue;
    }

    const targetP = findParticipantByDigits(participantes, d);
    if (!targetP) {
      resultados.push(`❌ *No encontré al usuario @${d} en este grupo.*`);
      mentionsOut.push(`${d}@s.whatsapp.net`);
      continue;
    }

    // Si el grupo usa LID, targetP.id suele ser @lid. groupParticipantsUpdate acepta ese id.
    const targetGroupId = targetP.id || targetP.jid;

    // Verificar si es Owner
    const isTargetOwner = Array.isArray(owners) && owners.some(function(entry) {
      let n = Array.isArray(entry) ? entry[0] : entry;
      return String(n).replace(/[^0-9]/g, "") === d;
    });

    // ✅ SE ELIMINÓ LA PROTECCIÓN DE ADMIN AQUÍ A PETICIÓN TUYA. Solo protegemos al owner.
    if (isTargetOwner) {
      resultados.push(`⚠️ *No se puede expulsar a @${d} (Owner).*`);
      mentionsOut.push(`${d}@s.whatsapp.net`);
      continue;
    }

    try {
      await conn.groupParticipantsUpdate(chatId, [targetGroupId], "remove");
      resultados.push(`✅ *Usuario @${d} expulsado.*`);
      mentionsOut.push(targetGroupId); // Usamos el ID del grupo para la mención
    } catch (err) {
      console.error("[kick] remove error:", err);
      resultados.push(`❌ *Error al expulsar a @${d}.*`);
      mentionsOut.push(targetGroupId);
    }
  }

  await conn.sendMessage(chatId, {
    text: resultados.join("\n"),
    mentions: mentionsOut
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "👢", key: msg.key } }).catch(() => {});
};

handler.command = ["kick"];
export default handler;
