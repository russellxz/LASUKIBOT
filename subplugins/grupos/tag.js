// plugins/tag.js — ESM-safe, respeta texto original y orden
import fs from 'fs';
import path from 'path';

// ✅ Usamos el patrón seguro para extraer solo números
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// —— Unwrap helpers (view-once / efímeros) ——
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}
function getQuotedMessage(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctx =
    root?.extendedTextMessage?.contextInfo ||
    root?.imageMessage?.contextInfo ||
    root?.videoMessage?.contextInfo ||
    root?.documentMessage?.contextInfo ||
    root?.audioMessage?.contextInfo ||
    root?.stickerMessage?.contextInfo ||
    null;
  return ctx?.quotedMessage ? unwrapMessage(ctx.quotedMessage) : null;
}
function getBodyRaw(msg) {
  const m = unwrapMessage(msg?.message) || {};
  return (
    m?.extendedTextMessage?.text ??
    m?.conversation ??
    ""
  );
}
function extractAfterAlias(body, aliases = [], prefixes = ["."]) {
  // NO recorta ni reordena; devuelve exactamente lo que viene tras el comando
  const bodyLow = body.toLowerCase();
  for (const p of prefixes) {
    for (const a of aliases) {
      const tag = (p + a).toLowerCase();
      if (bodyLow.startsWith(tag)) {
        let out = body.slice(tag.length);
        // quita sólo un espacio inicial si existe (no más)
        return out.startsWith(" ") ? out.slice(1) : out;
      }
    }
  }
  return "";
}
async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function")
    return wa.downloadContentFromMessage;
  try {
    const m = await import("@whiskeysockets/baileys");
    return m.downloadContentFromMessage;
  } catch {
    return null;
  }
}

const handler = async (msg, { conn, args, text, wa }) => {
  try {
    const chatId   = msg.key.remoteJid;
    const isGroup  = chatId.endsWith("@g.us");
    
    // ✅ Obtener senderNum de forma robusta
    const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
    const senderNum = String(msg.realNumber || DIGITS(senderId.split(":")[0]));
    
    const isFromMe = !!msg.key.fromMe;

    if (!isGroup) {
      return conn.sendMessage(chatId, { text: "⚠️ Este comando solo se puede usar en grupos." }, { quoted: msg });
    }

    const rawID   = conn.user?.id || "";
    const botNum  = DIGITS(rawID.split(":")[0]);
    const isBot   = botNum === senderNum;
    
    // ✅ Validación robusta de owner
    const isOwner = Array.isArray(global.owner) && global.owner.some(function(entry) {
        let n = Array.isArray(entry) ? entry[0] : entry;
        return String(n).replace(/[^0-9]/g, "") === senderNum;
    });

    // Metadata del grupo
    let meta;
    try { meta = await conn.groupMetadata(chatId); }
    catch (e) {
      console.error("[tag] metadata error:", e);
      return conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
    }
    const participantes = Array.isArray(meta?.participants) ? meta.participants : [];

    // ✅ Validación robusta de Admin (La misma de modoadmins)
    let isAdmin = false;
    const adminNums = new Set();

    for (let i = 0; i < participantes.length; i++) {
      let p = participantes[i];
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
    
    isAdmin = adminNums.has(senderNum);

    if (!isAdmin && !isOwner && !isBot && !isFromMe) {
      return conn.sendMessage(chatId, {
        text: "❌ Solo admins, el owner o el bot pueden usar este comando."
      }, { quoted: msg });
    }

    await conn.sendMessage(chatId, { react: { text: "🔊", key: msg.key } }).catch(() => {});

    // Menciones en el MISMO orden que entrega WhatsApp
    const seen = new Set();
    const mentionsOrdered = [];
    for (const p of participantes) {
      const jid = p?.id || p?.jid;
      if (!jid) continue;
      const d = DIGITS(jid);
      if (d && !seen.has(d)) {
        seen.add(d);
        mentionsOrdered.push(jid);
      }
    }

    // Descargar citado si existe
    const quoted = getQuotedMessage(msg);
    const DL = await getDownloader(wa);
    let messageToForward = null;
    let hasMedia = false;

    if (quoted) {
      if (quoted.conversation != null) {
        // Respeta EXACTAMENTE el texto original
        messageToForward = { text: quoted.conversation };
      } else if (quoted.extendedTextMessage?.text != null) {
        messageToForward = { text: quoted.extendedTextMessage.text };
      } else if (quoted.imageMessage && DL) {
        const stream = await DL(quoted.imageMessage, "image");
        let buffer = Buffer.alloc(0);
        for await (const c of stream) buffer = Buffer.concat([buffer, c]);
        messageToForward = {
          image: buffer,
          mimetype: quoted.imageMessage.mimetype || "image/jpeg",
          // caption EXACTA, sin trims
          caption: quoted.imageMessage.caption ?? ""
        };
        hasMedia = true;
      } else if (quoted.videoMessage && DL) {
        const stream = await DL(quoted.videoMessage, "video");
        let buffer = Buffer.alloc(0);
        for await (const c of stream) buffer = Buffer.concat([buffer, c]);
        messageToForward = {
          video: buffer,
          mimetype: quoted.videoMessage.mimetype || "video/mp4",
          caption: quoted.videoMessage.caption ?? "",
          gifPlayback: !!quoted.videoMessage.gifPlayback
        };
        hasMedia = true;
      } else if (quoted.audioMessage && DL) {
        const stream = await DL(quoted.audioMessage, "audio");
        let buffer = Buffer.alloc(0);
        for await (const c of stream) buffer = Buffer.concat([buffer, c]);
        messageToForward = {
          audio: buffer,
          mimetype: quoted.audioMessage.mimetype || "audio/mpeg",
          ptt: !!quoted.audioMessage.ptt
        };
        hasMedia = true;
      } else if (quoted.stickerMessage && DL) {
        const stream = await DL(quoted.stickerMessage, "sticker");
        let buffer = Buffer.alloc(0);
        for await (const c of stream) buffer = Buffer.concat([buffer, c]);
        messageToForward = { sticker: buffer };
        hasMedia = true;
      } else if (quoted.documentMessage && DL) {
        const stream = await DL(quoted.documentMessage, "document");
        let buffer = Buffer.alloc(0);
        for await (const c of stream) buffer = Buffer.concat([buffer, c]);
        messageToForward = {
          document: buffer,
          mimetype: quoted.documentMessage.mimetype || "application/octet-stream",
          fileName: quoted.documentMessage.fileName || undefined,
          caption: quoted.documentMessage.caption ?? ""
        };
        hasMedia = true;
      }
    }

    // Si NO hay citado (o no era media) toma el texto EXACTO tras el comando (sin .join())
    if (!messageToForward) {
      const prefixes = Array.isArray((typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)) ? (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes) : ["."];
      const body = getBodyRaw(msg);
      const rawText = extractAfterAlias(body, ["tag", "n", "notify"], prefixes);
      if (rawText && rawText.length > 0) {
        messageToForward = { text: rawText }; // sin trims: respeta saltos/espacios/origen
      }
    }

    if (!messageToForward) {
      return conn.sendMessage(chatId, {
        text: "⚠️ Responde a un mensaje o escribe un texto tras el comando para reenviar."
      }, { quoted: msg });
    }

    // Enviar preservando orden del texto y orden de menciones
    await conn.sendMessage(
      chatId,
      { ...messageToForward, mentions: mentionsOrdered },
      { quoted: msg }
    );

  } catch (err) {
    console.error("❌ Error en el comando tag:", err);
    await conn.sendMessage(msg.key.remoteJid, { text: "❌ Ocurrió un error al ejecutar el comando." }, { quoted: msg });
  }
};

handler.command = ["tag", "n", "notify"];
export default handler;
