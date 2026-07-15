// plugins/tagall.js
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
    console.error("[tagall] Error reading admins:", e);
    return false;
  }
}

const handler = async (msg, { conn, args }) => {
  try {
    const chatId   = msg.key.remoteJid;
    const isGroup  = chatId.endsWith("@g.us");
    const isFromMe = !!msg.key.fromMe;

    await conn.sendMessage(chatId, { react: { text: "🔊", key: msg.key } }).catch(() => {});

    if (!isGroup) {
      return conn.sendMessage(chatId, { text: "⚠️ *Este comando solo puede usarse en grupos.*" }, { quoted: msg });
    }

    // ✅ Obtener senderNum de forma robusta
    const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
    const senderNum = String(msg.realNumber || DIGITS(senderId.split(":")[0]));

    // Permisos: admin (LID-aware robusto)
    const isAdmin = await isAdminByNumber(conn, chatId, senderNum);

    // Owners desde owner.json (fallback a global.owner) + validación robusta
    const ownerPath = path.resolve("owner.json");
    const owners = fs.existsSync(ownerPath) 
      ? JSON.parse(fs.readFileSync(ownerPath, "utf-8")) 
      : (global.owner || []);
      
    const isOwner = Array.isArray(owners) && owners.some(function(entry) {
      let n = Array.isArray(entry) ? entry[0] : entry;
      return String(n).replace(/[^0-9]/g, "") === senderNum;
    });

    if (!isAdmin && !isOwner && !isFromMe) {
      return conn.sendMessage(chatId, {
        text: "🚫 *Este comando solo puede usarlo un administrador o el dueño del bot.*"
      }, { quoted: msg });
    }

    // Metadata
    let meta;
    try {
      meta = await conn.groupMetadata(chatId);
    } catch (e) {
      console.error("[tagall] metadata error:", e);
      return conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
    }

    const participantes = Array.isArray(meta?.participants) ? meta.participants : [];

    // Menciones: usa el id tal como viene (soporta @lid y @s.whatsapp.net); fallback a .jid si faltara
    const mentionIdsRaw = participantes.map(p => p?.id || p?.jid).filter(Boolean);
    
    // De-duplicar por dígitos para evitar dobles si vienen id y jid
    const seen = new Set();
    const mentionIds = [];
    for (const jid of mentionIdsRaw) {
      const d = DIGITS(jid);
      if (!seen.has(d)) {
        seen.add(d);
        mentionIds.push(jid);
      }
    }

    const mentionList = mentionIds.map(id => `➤ @${id.split("@")[0]}`).join("\n");
    const extraMsg = (args || []).join(" ");

    let finalMsg  = `╭─⌈ 🔊 𝐓𝐀𝐆𝐀𝐋𝐋 𝐌𝐎𝐃𝐄 ⌋──╮\n`;
        finalMsg += `│ 🤖 *✧ Sᵘᵏⁱ 3.0 ᴮᵒᵗ ✧*\n`;
        finalMsg += `│ 👤 *Invocador:* @${senderNum}\n`;
    if (extraMsg.length > 0) {
        finalMsg += `│ 💬 *Mensaje:* ${extraMsg}\n`;
    }
        finalMsg += `╰──────────────╯\n\n`;
        finalMsg += `📢 *Etiquetando a todos los miembros...*\n\n`;
        finalMsg += mentionList;

    await conn.sendMessage(chatId, {
      image: { url: "https://cdn.russellxz.click/034af9ef.jpeg" },
      caption: finalMsg,
      mentions: mentionIds
    }, { quoted: msg });

  } catch (err) {
    console.error("❌ Error en el comando tagall:", err);
    await conn.sendMessage(msg.key.remoteJid, { text: "❌ Ocurrió un error al ejecutar el comando tagall." }, { quoted: msg });
  }
};

handler.command = ["tagall", "invocar", "todos"];
export default handler;
