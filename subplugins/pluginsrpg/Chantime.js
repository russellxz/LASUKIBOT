// plugins/chantime.js
import fs from 'fs';
import path from 'path';

function parseTiempo(str) {
  const m = String(str || "").toLowerCase().trim().match(/^(\d+)\s*([mh])$/i);
  if (!m) return null;
  const valor = parseInt(m[1], 10);
  const unidad = m[2].toLowerCase();
  const ms = unidad === "m" ? valor * 60 * 1000 : valor * 60 * 60 * 1000;
  return { valor, unidad, ms, texto: `${valor}${unidad}` };
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  // 🔒 Solo owners o el propio bot
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  // 📌 Debe venir el tiempo
  if (!args[0]) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso correcto:*\n.chantime <tiempo> (respondiendo o mencionando a un usuario)\n\n` +
            `📌 Ejemplos:\n• Responde a un usuario: .chantime 30m\n• Menciona: .chantime 2h @usuario\n\n` +
            `⏱️ Formatos: 5m, 30m, 2h, 24h`,
      quoted: msg
    });
  }

  // ⛹️‍♂️ Obtener objetivo por respuesta o mención
  let targetJid = null;
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (ctx?.quotedMessage) targetJid = ctx.participant;
  if (!targetJid && ctx?.mentionedJid?.length) targetJid = ctx.mentionedJid[0];

  if (!targetJid) {
    return conn.sendMessage(chatId, {
      text: "⚠️ Debes *responder/citar* al usuario objetivo o *mencionarlo*.",
      quoted: msg
    });
  }

  const targetNum = String(targetJid).replace(/\D/g, "");
  const tiempo = parseTiempo(args[0]);
  if (!tiempo) {
    return conn.sendMessage(chatId, {
      text: "❌ Tiempo inválido. Usa minutos (m) u horas (h). Ej: 5m, 45m, 2h, 24h",
      quoted: msg
    });
  }

  // 📂 Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(sukirpgPath)) {
    return conn.sendMessage(chatId, { text: "❌ No existe la base de datos del RPG.", quoted: msg });
  }
  const db = JSON.parse(fs.readFileSync(sukirpgPath, "utf-8")) || {};
  db.banco = db.banco || null;
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  if (!db.banco) {
    return conn.sendMessage(chatId, { text: "🏦 No hay banco configurado. Usa *.addbank* primero.", quoted: msg });
  }

  db.banco.prestamos = Array.isArray(db.banco.prestamos) ? db.banco.prestamos : [];

  // 🔎 Prestamo activo del objetivo
  const prestamo = db.banco.prestamos.find(p => String(p.numero) === targetNum && p.estado === "activo");

  if (!prestamo) {
    return conn.sendMessage(chatId, {
      text: `ℹ️ El usuario @${targetNum} no tiene un préstamo *activo*.`,
      mentions: [`${targetNum}@s.whatsapp.net`],
      quoted: msg
    });
  }

  // 🛠️ Ajuste SOLO a ese usuario: reinicia plazo a partir de ahora
  const ahora = Date.now();
  prestamo.fechaInicio = ahora;
  prestamo.fechaLimite = ahora + tiempo.ms;

  // Guardar historial del ajuste
  prestamo.historial = Array.isArray(prestamo.historial) ? prestamo.historial : [];
  prestamo.historial.push({
    fecha: ahora,
    tipo: "ajuste_plazo_manual",
    nuevoPlazoMs: tiempo.ms,
    descripcion: `Plazo reiniciado a ${tiempo.texto} por owner`
  });

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // 📨 Confirmación
  await conn.sendMessage(chatId, {
    text:
`✅ *Plazo actualizado para @${targetNum}*
⏳ Nuevo plazo: *${tiempo.texto}*
🕒 Vence: *${new Date(prestamo.fechaLimite).toLocaleString()}*

📌 Nota: Solo se modificó el plazo del *usuario citado/ mencionado*.`,
    mentions: [`${targetNum}@s.whatsapp.net`],
    quoted: msg
  });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["chantime"];
export default handler;
