// plugins/darlider.js
// Uso: .darlider <numOpcional>  (o responde/mention a la persona)
// Solo owners. Asigna a un usuario como LÍDER del CLAN SUPREMO.

import fs from 'fs';
import path from 'path';

function loadDB(p){ return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : {}; }
function saveDB(p,o){ fs.writeFileSync(p, JSON.stringify(o,null,2)); }

function isOwnerNumber(numero, conn) {
  try { if (typeof global.isOwner === "function") return !!global.isOwner(numero); } catch {}
  try { if (Array.isArray(global.owner)) return global.owner.some(([n]) => String(n) === String(numero)); } catch {}
  const botID = (conn.user?.id || "").replace(/\D/g, "");
  return String(numero) === String(botID);
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = !!msg.key.fromMe;

  // Permisos (igual que addowner)
  if (!isOwnerNumber(numero, conn) && !fromMe) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando.",
      quoted: msg
    });
  }

  await conn.sendMessage(chatId, { react: { text: "⚙️", key: msg.key } });

  // Obtener objetivo: número por arg, respuesta o mención
  let objetivoNum = (args?.[0] || "").replace(/\D/g,"");
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!objetivoNum && ctx?.participant) objetivoNum = ctx.participant.replace(/\D/g,"");
  if (!objetivoNum && ctx?.mentionedJid?.length) objetivoNum = ctx.mentionedJid[0].replace(/\D/g,"");

  if (!objetivoNum) {
    return conn.sendMessage(chatId, {
      text: "✳️ Uso: *.darlider <num>* o responde/ menciona al usuario.",
      quoted: msg
    });
  }

  const file = path.join(process.cwd(), "sukirpg.json");
  const db = loadDB(file);

  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.clanes   = Array.isArray(db.clanes)   ? db.clanes   : [];

  const usuario = db.usuarios.find(u => String(u.numero) === String(objetivoNum));
  if (!usuario) {
    return conn.sendMessage(chatId, { text: "❌ Ese usuario no está registrado en el RPG.", quoted: msg });
  }

  // Buscar el clan supremo (solo puede existir uno)
  const clanesSupremos = db.clanes.filter(c => c.esSupremo);
  if (!clanesSupremos.length) {
    return conn.sendMessage(chatId, { text: "⚠️ No existe un clan supremo todavía. Crea uno con *.clansupremo*.", quoted: msg });
  }
  if (clanesSupremos.length > 1) {
    return conn.sendMessage(chatId, { text: "⚠️ Hay más de un clan supremo en la DB. Arregla la DB primero.", quoted: msg });
  }
  const clan = clanesSupremos[0];

  // ¿El usuario ya está en otro clan distinto?
  const clanDeUsuario = db.clanes.find(c => Array.isArray(c.miembros) && c.miembros.some(m => String(m.numero) === String(objetivoNum)));
  if (clanDeUsuario && clanDeUsuario.id !== clan.id) {
    return conn.sendMessage(chatId, {
      text: `🚫 Ese usuario ya pertenece al clan *${clanDeUsuario.nombre}*. Debe salir de su clan antes de ser líder del supremo.`,
      quoted: msg
    });
  }

  // Asegurar estructura de miembros
  clan.miembros = Array.isArray(clan.miembros) ? clan.miembros : [];

  // Quitar cualquier otro "lider" en miembros del supremo
  clan.miembros = clan.miembros.map(m => (m.rol === "lider" ? { ...m, rol: "miembro" } : m));

  // Agregar/actualizar este usuario como líder en miembros
  const ya = clan.miembros.find(m => String(m.numero) === String(objetivoNum));
  const ahora = Date.now();
  if (ya) {
    ya.rol = "lider";
    ya.desde = ya.desde || ahora;
  } else {
    clan.miembros.push({ numero: objetivoNum, rol: "lider", desde: ahora });
  }

  // Actualizar encabezado de líder del clan (reemplaza a "La Suki Bot")
  clan.lider = {
    numero: usuario.numero,
    nombre: usuario.nombre || "",
    apellido: usuario.apellido || "",
    nivel: Number(usuario.nivel || 1)
  };

  // (Opcional) marcar en el usuario su clan actual
  try {
    usuario.clanId = clan.id;
    usuario.rolClan = "lider";
  } catch {}

  saveDB(file, db);

  await conn.sendMessage(chatId, {
    text:
`✅ *Líder asignado al Clan Supremo*
🏷️ Clan: *${clan.nombre}*
👑 Nuevo líder: @${usuario.numero}
👥 Miembros: ${clan.miembros.length}

Si deseas cambiarlo de nuevo, repite *.darlider* con otro usuario.`,
    mentions: [`${usuario.numero}@s.whatsapp.net`],
    quoted: msg
  });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["darlider"];
export default handler;
