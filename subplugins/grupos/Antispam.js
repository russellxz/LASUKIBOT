// subplugins/grupos/Antispam.js — corta el spam de repetir lo mismo
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
    console.error("[antispam] Error reading admins:", e);
    return false;
  }
}

const handler = async (msg, { conn }) => {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  const senderId = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const senderNo = String(msg.realNumber || DIGITS(senderId.split(":")[0]));

  const isFromMe = !!msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "🔇", key: msg.key } }).catch(() => {});

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
    const activo = Number(conn.getSubConfig(chatId, "antispam")) === 1;

    await conn.sendMessage(chatId, {
      text:
`🔇 *ANTISPAM* — corta el spam de repetir lo mismo

Estado actual: *${activo ? "activado ✅" : "desactivado ❌"}*

✳️ Usa:
.antispam on
.antispam off

Cómo funciona: se cuenta cuántas veces manda alguien el *mismo* mensaje.
Las *3* primeras pasan. De la *4ª* en adelante el bot lo borra, y a las
*7* lo saca del grupo.

⏳ Para que la cuenta vuelva a cero hay que esperar *3 minutos* sin
mandarlo. Si lo repite antes, suma otra vez.

Vale hasta para una sola letra: mandar "a" siete veces también es spam, y
da igual que vaya cambiando de letra ("a t u a t u a") porque las de una
sola letra cuentan juntas. Las respuestas de dos letras ("si", "ok", "ya")
no se tocan.

📌 Lo que lleve escrito el mensaje da igual. "aaaaaaaaaaaaaa" o "hhhhhh"
no son spam por sí solos, por muchas letras que repitan: lo son cuando se
mandan varias veces, igual que cualquier otro mensaje.

📌 Se aplica a *todos*, admins incluidos. Solo los dueños del bot quedan
fuera. Si no, el spam de un admin no se podría cortar.

⚠️ El bot necesita ser *administrador* para poder borrar y expulsar.`
    }, { quoted: msg });
    return;
  }

  if (estado === "on") {
    conn.setSubConfig(chatId, "antispam", 1);
  } else {
    conn.deleteSubConfig(chatId, "antispam");
  }

  await conn.sendMessage(chatId, {
    text:
`🔇 AntiSpam ha sido *${estado === "on" ? "activado" : "desactivado"}* correctamente en este grupo.` +
(estado === "on"
  ? `\n\n📡 A partir de ahora cuento los mensajes repetidos.\n🗑️ Del *4º* igual seguido en adelante lo borro.\n🚫 A los *7* seguidos, fuera del grupo.\n\n⚠️ Recuerda darme *admin* para que pueda borrar.`
  : "")
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  console.log(`📌 AntiSpam ${estado.toUpperCase()} guardado en activos.db para ${chatId}`);
};

handler.command = ["antispam"];
export default handler;
