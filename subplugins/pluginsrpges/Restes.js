// plugins/restes.js
// Comando: .restes
// Solo owners/bot. Resetea el sistema de esclavos:
// - Elimina todos los contratos en db.esclavos
// - Limpia en cada usuario los campos esclavoDe / esclavitud
// No toca saldos ni otras partes del RPG.

import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = !!msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/\D/g, "");

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "🧹", key: msg.key } });

  // 🔒 Solo Owner / Bot
  if (!global.isOwner?.(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(
      chatId,
      { text: "🚫 Solo los owners o el bot pueden usar este comando." },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return;
  }

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(sukirpgPath)) {
    await conn.sendMessage(
      chatId,
      { text: "❌ No existe la base de datos (sukirpg.json)." },
      { quoted: msg }
    );
    return;
  }

  // Cargar DB
  let db;
  try {
    db = JSON.parse(fs.readFileSync(sukirpgPath, "utf8")) || {};
  } catch {
    await conn.sendMessage(
      chatId,
      { text: "⚠️ No se pudo leer la base de datos." },
      { quoted: msg }
    );
    return;
  }

  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.esclavos = Array.isArray(db.esclavos) ? db.esclavos : [];

  const contratosAntes = db.esclavos.length;

  // Limpiar contratos
  db.esclavos = [];

  // Limpiar flags en usuarios
  let usuariosAfectados = 0;
  for (const u of db.usuarios) {
    if (u && (u.esclavoDe || u.esclavitud)) {
      delete u.esclavoDe;
      delete u.esclavitud;
      usuariosAfectados++;
    }
  }

  // Guardar
  try {
    fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));
  } catch {
    await conn.sendMessage(
      chatId,
      { text: "⚠️ No se pudo guardar la base de datos." },
      { quoted: msg }
    );
    return;
  }

  // Aviso
  await conn.sendMessage(
    chatId,
    {
      text:
        `✅ *Sistema de esclavos reseteado*\n` +
        `• Contratos eliminados: *${contratosAntes}*\n` +
        `• Usuarios limpiados: *${usuariosAfectados}*\n\n` +
        `📌 El scheduler de recompensas ignorará todo hasta que se creen nuevos contratos con *.comprares*.`
    },
    { quoted: msg }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["restes"];
export default handler;
