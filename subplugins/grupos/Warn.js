// subplugins/grupos/Warn.js — advertir a un usuario del grupo
import fs from 'fs';
import path from 'path';
import { isAdminByNumber, numeroDelRemitente } from '../../libs/adminCheck.js';
import { darAviso, limpiarAvisos, AVISOS_MAX } from '../../libs/avisos.js';

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** A quién se advierte: al citado, al mencionado, o a un número escrito. */
function objetivoDe(msg, args) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    null;

  const mencionado = ctx?.mentionedJid?.[0];
  if (mencionado) return DIGITS(String(mencionado).split(":")[0]);

  if (ctx?.participant) return DIGITS(String(ctx.participant).split(":")[0]);

  // .warn 5215551234 motivo
  const primero = DIGITS(args[0] || "");
  if (primero.length >= 7) return primero;

  return "";
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderNo = numeroDelRemitente(msg);
  const isFromMe = !!msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "⚠️", key: msg.key } }).catch(() => {});

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo puede usarse en grupos."
    }, { quoted: msg });
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  let owners = [];
  try { owners = JSON.parse(fs.readFileSync(path.resolve("owner.json"), "utf-8")); }
  catch { owners = global.owner || []; }

  const isOwner = Array.isArray(owners) && owners.some((e) => {
    const n = Array.isArray(e) ? e[0] : e;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores pueden usar este comando."
    }, { quoted: msg });
  }

  const objetivo = objetivoDe(msg, args);

  if (!objetivo) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *WARN* — advertir a un usuario

✳️ Usa:
  • Citando su mensaje: *.warn <motivo>*
  • Mencionando: *.warn @usuario <motivo>*
  • Por número: *.warn 5215551234 <motivo>*

A las *${AVISOS_MAX}* advertencias el bot lo saca del grupo.
Para quitarle una: *.unwarn*`
    }, { quoted: msg });
  }

  // El motivo es todo menos el número, si es que se escribió
  const resto = args.filter((a) => DIGITS(a) !== objetivo || DIGITS(a).length < 7);
  const motivo = resto.join(" ").trim() || "Sin motivo";

  const jidObjetivo = `${objetivo}@s.whatsapp.net`;
  const { total, limite } = darAviso(conn, chatId, objetivo, motivo, senderNo);

  if (limite) {
    await conn.sendMessage(chatId, {
      text:
`🚫 *USUARIO ELIMINADO*

👤 @${objetivo}
📊 Advertencias: *${total}/${AVISOS_MAX}*
📝 Última: _${motivo}_

Se acabaron las oportunidades.`,
      mentions: [jidObjetivo]
    }, { quoted: msg });

    try {
      await conn.groupParticipantsUpdate(chatId, [jidObjetivo], "remove");
      limpiarAvisos(conn, chatId, objetivo);
    } catch (e) {
      console.error("[warn] no pude expulsar:", e.message);
      await conn.sendMessage(chatId, {
        text: "⚠️ No pude expulsarlo: necesito ser administrador del grupo."
      }, { quoted: msg });
    }

    return conn.sendMessage(chatId, { react: { text: "🚫", key: msg.key } }).catch(() => {});
  }

  await conn.sendMessage(chatId, {
    text:
`⚠️ *ADVERTENCIA ${total}/${AVISOS_MAX}*

👤 @${objetivo}
📝 Motivo: _${motivo}_
👮 Puesta por: @${senderNo}

Si llegas a *${AVISOS_MAX}* serás eliminado del grupo.`,
    mentions: [jidObjetivo, `${senderNo}@s.whatsapp.net`]
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
};

handler.command = ["warn", "advertir"];
handler.help = ["warn <@usuario o citando> <motivo>"];
handler.tags = ["grupos"];

export default handler;
