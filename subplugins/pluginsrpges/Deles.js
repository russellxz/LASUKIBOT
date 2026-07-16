// plugins/delesclavo.js
// Comando: .deles <número>
// Elimina un esclavo comprado por el dueño

import fs from 'fs';
import path from 'path';

function cargarDB(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; }
function guardarDB(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const ownerNum = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } });

  // Validación
  if (!args[0] || isNaN(args[0])) {
    return conn.sendMessage(chatId, {
      text: "✳️ Uso: *.deles <número>*\n📌 Ej: *.deles 1*",
      quoted: msg
    });
  }

  const index = parseInt(args[0]) - 1;
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = cargarDB(sukirpgPath);

  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.esclavos = Array.isArray(db.esclavos) ? db.esclavos : [];

  const ownerUser = db.usuarios.find(u => String(u.numero) === ownerNum);
  if (!ownerUser) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG.",
      quoted: msg
    });
  }

  // Filtrar esclavos que pertenezcan a este dueño
  const esclavosDueño = db.esclavos.filter(c => String(c.dueno || c.owner) === ownerNum);

  if (!esclavosDueño.length) {
    return conn.sendMessage(chatId, {
      text: "📭 No tienes esclavos activos para borrar.",
      quoted: msg
    });
  }

  if (index < 0 || index >= esclavosDueño.length) {
    return conn.sendMessage(chatId, {
      text: `❌ Número inválido. Debe estar entre 1 y ${esclavosDueño.length}.`,
      quoted: msg
    });
  }

  // Obtener esclavo a eliminar
  const contrato = esclavosDueño[index];
  const slaveNum = String(contrato.objetivo || contrato.slave);

  // Eliminar del array global
  const posGlobal = db.esclavos.findIndex(c => c.id === contrato.id);
  if (posGlobal !== -1) {
    db.esclavos.splice(posGlobal, 1);
  }

  // Quitar marca de esclavo del usuario objetivo
  const slaveUser = db.usuarios.find(u => String(u.numero) === slaveNum);
  if (slaveUser) {
    delete slaveUser.esclavoDe;
    delete slaveUser.esclavitud;
  }

  guardarDB(sukirpgPath, db);

  await conn.sendMessage(chatId, {
    text: `🗑️ Se eliminó el contrato con @${slaveNum}.\nYa no es tu esclavo.`,
    mentions: [`${slaveNum}@s.whatsapp.net`],
    quoted: msg
  });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["deles", "eliminaresclavo"];
export default handler;
