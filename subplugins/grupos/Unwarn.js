// subplugins/grupos/Unwarn.js — quitar una advertencia
import fs from 'fs';
import path from 'path';
import { isAdminByNumber, numeroDelRemitente } from '../../libs/adminCheck.js';
import { quitarAviso, verAvisos, AVISOS_MAX } from '../../libs/avisos.js';

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** A quién se le quita: al citado, al mencionado, o a un número escrito. */
function objetivoDe(msg, args) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    null;

  const mencionado = ctx?.mentionedJid?.[0];
  if (mencionado) return DIGITS(String(mencionado).split(":")[0]);

  if (ctx?.participant) return DIGITS(String(ctx.participant).split(":")[0]);

  const primero = DIGITS(args[0] || "");
  if (primero.length >= 7) return primero;

  return "";
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderNo = numeroDelRemitente(msg);
  const isFromMe = !!msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "🧽", key: msg.key } }).catch(() => {});

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
`🧽 *UNWARN* — quitar una advertencia

✳️ Usa:
  • Citando su mensaje: *.unwarn*
  • Mencionando: *.unwarn @usuario*
  • Por número: *.unwarn 5215551234*

Quita la última advertencia que tenga.`
    }, { quoted: msg });
  }

  const jidObjetivo = `${objetivo}@s.whatsapp.net`;
  const antes = verAvisos(conn, chatId, objetivo);

  if (!antes.total) {
    return conn.sendMessage(chatId, {
      text: `✅ @${objetivo} no tiene ninguna advertencia.`,
      mentions: [jidObjetivo]
    }, { quoted: msg });
  }

  const { total, quitado } = quitarAviso(conn, chatId, objetivo);

  await conn.sendMessage(chatId, {
    text:
`🧽 *ADVERTENCIA RETIRADA*

👤 @${objetivo}
📊 Le quedan: *${total}/${AVISOS_MAX}*
${quitado?.motivo ? `📝 Se le quitó: _${quitado.motivo}_` : ""}
👮 Retirada por: @${senderNo}`.trim(),
    mentions: [jidObjetivo, `${senderNo}@s.whatsapp.net`]
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
};

handler.command = ["unwarn", "quitaradvertencia"];
handler.help = ["unwarn <@usuario o citando>"];
handler.tags = ["grupos"];

export default handler;
