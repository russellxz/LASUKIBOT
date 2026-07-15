// plugins/modoadmins.js
import path from 'path';

const DIGITS = function(s) { return String(s || "").replace(/[^0-9]/g, ""); };

function isLid(j) { return typeof j === "string" && j.endsWith("@lid"); }
function isUser(j) { return typeof j === "string" && j.endsWith("@s.whatsapp.net"); }

/**
 * Busca un participante en la lista.
 * Compara por dígitos del p.id Y del p.jid (campo real en grupos LID).
 * También usa global.lidMap si está disponible.
 */
function findParticipant(parts, senderRaw, senderNum, realJid) {
  if (!Array.isArray(parts) || !parts.length) return null;

  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var pid  = String(p.id  || "");
    var pjid = String(p.jid || "");

    // 1) Coincidencia directa por JID completo
    if (senderRaw && (pid === senderRaw || pjid === senderRaw)) return p;
    if (realJid   && (pid === realJid   || pjid === realJid))   return p;

    // 2) Coincidencia por dígitos en campos @s.whatsapp.net
    if (isUser(pid)  && DIGITS(pid)  === senderNum) return p;
    if (isUser(pjid) && DIGITS(pjid) === senderNum) return p;

    // 3) Si p.id es @lid, resolver con lidMap global
    if (isLid(pid) && global.lidMap instanceof Map) {
      var resolved = global.lidMap.get(pid);
      if (resolved && isUser(resolved) && DIGITS(resolved) === senderNum) return p;
    }
    if (isLid(pjid) && global.lidMap instanceof Map) {
      var resolved2 = global.lidMap.get(pjid);
      if (resolved2 && isUser(resolved2) && DIGITS(resolved2) === senderNum) return p;
    }
  }

  return null;
}

const handler = async function(msg, opts) {
  var conn = opts.conn;
  try {
    var chatId  = msg.key.remoteJid;
    var isGroup = chatId.endsWith("@g.us");
    var fromMe  = !!msg.key.fromMe;

    if (!isGroup) {
      await conn.sendMessage(chatId, { text: "❌ Este comando solo se puede usar en grupos." }, { quoted: msg });
      return;
    }

    // Sender: preferir msg.realJid (ya normalizado por el index), si no usar participant/remoteJid
    var senderRaw = msg.realJid || msg.key.participant || msg.key.remoteJid || "";
    var senderNum = DIGITS(senderRaw.split(":")[0]);

    // También guardar el JID raw original (puede ser @lid antes de normalizar)
    var senderRawOriginal = msg.key.participant || msg.key.remoteJid || "";

    // Metadata del grupo
    var metadata = await conn.groupMetadata(chatId);
    var participantes = Array.isArray(metadata && metadata.participants) ? metadata.participants : [];

    // Buscar al autor con la función robusta
    var authorP = findParticipant(participantes, senderRaw, senderNum, senderRawOriginal);

    // Log de debug (puedes quitarlo después)
    console.log("[modoadmins] senderRaw:", senderRaw, "| senderNum:", senderNum);
    console.log("[modoadmins] authorP:", authorP ? (authorP.id + " admin:" + authorP.admin) : "NO ENCONTRADO");

    var isAdmin = !!authorP && (authorP.admin === "admin" || authorP.admin === "superadmin");

    if (!isAdmin && !fromMe) {
      await conn.sendMessage(chatId, { text: "❌ Solo los administradores del grupo pueden usar este comando." }, { quoted: msg });
      return;
    }

    // Leer args
    var messageText =
      (msg.message && msg.message.conversation) ||
      (msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) ||
      "";

    var args   = messageText.trim().split(/\s+/).slice(1);
    var estado = (args[0] || "").toLowerCase();

    if (estado !== "on" && estado !== "off") {
      await conn.sendMessage(chatId, { text: "✳️ Usa correctamente:\n\n.modoadmins on / off" }, { quoted: msg });
      return;
    }

    if (estado === "on") {
      conn.setSubConfig(chatId, "modoadmins", 1);
    } else {
      conn.deleteSubConfig(chatId, "modoadmins");
    }

    await conn.sendMessage(chatId, {
      text: "👑 Modo admins *" + (estado === "on" ? "activado" : "desactivado") + "* en este grupo."
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(function() {});

  } catch (err) {
    console.error("❌ Error en modoadmins:", err);
    await conn.sendMessage(msg.key.remoteJid, { text: "❌ Ocurrió un error al cambiar el modo admins." }, { quoted: msg });
    await conn.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } }).catch(function() {});
  }
};

handler.command = ["modoadmins"];
export default handler;
