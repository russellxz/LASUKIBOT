// plugins/pluginsgrupos/Antiporno.js — activa el filtro de contenido +18
import fs from 'fs';
import path from 'path';
import { getConfig, setConfig, deleteConfig } from '../../db.js';

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
    console.error("[antiporno] Error reading admins:", e);
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));

  const isFromMe = !!msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "🔞", key: msg.key } }).catch(() => {});

  if (!isGroup) {
    await conn.sendMessage(chatId, {
      text: "❌ Este comando solo puede usarse en grupos."
    }, { quoted: msg });
    return;
  }

  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);

  const ownerPath = path.resolve("owner.json");
  let owners = [];
  try { owners = JSON.parse(fs.readFileSync(ownerPath, "utf-8")); }
  catch { owners = global.owner || []; }

  const isOwner = Array.isArray(owners) && owners.some(function(entry) {
    let n = Array.isArray(entry) ? entry[0] : entry;
    return String(n).replace(/[^0-9]/g, "") === senderNo;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores pueden usar este comando."
    }, { quoted: msg });
    return;
  }

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";
  const args   = body.trim().split(/\s+/).slice(1);
  const estado = (args[0] || "").toLowerCase();

  if (!["on", "off"].includes(estado)) {
    const activo = parseInt(getConfig(chatId, "antiporno")) === 1;

    await conn.sendMessage(chatId, {
      text:
`🔞 *ANTIPORNO* — filtro de contenido +18

Estado actual: *${activo ? "activado ✅" : "desactivado ❌"}*

✳️ Usa:
.antiporno on
.antiporno off

Con esto activado, el bot analiza en silencio cada imagen, sticker, GIF
o video del grupo. Si detecta contenido +18 lo borra y avisa. A los *5*
avisos, quien lo mandó sale del grupo.

⚠️ El bot necesita ser *administrador* para poder borrar y expulsar.`
    }, { quoted: msg });
    return;
  }

  if (estado === "on") {
    setConfig(chatId, "antiporno", 1);
  } else {
    deleteConfig(chatId, "antiporno");
  }

  await conn.sendMessage(chatId, {
    text:
`🔞 AntiPorno ha sido *${estado === "on" ? "activado" : "desactivado"}* correctamente en este grupo.` +
(estado === "on"
  ? `\n\n📡 A partir de ahora reviso cada imagen, sticker, GIF y video.\n🗑️ El contenido +18 se borra al momento.\n🚫 A los *5* avisos, fuera del grupo.\n\n⚠️ Recuerda darme *admin* para que pueda borrar.`
  : "")
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  console.log(`📌 AntiPorno ${estado.toUpperCase()} guardado en activos.db para ${chatId}`);
};

handler.command = ["antiporno"];
export default handler;
