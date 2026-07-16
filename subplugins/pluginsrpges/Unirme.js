// Comando: .unirme <ID del clan>
// Requisitos: nivel del usuario >= minNivelParaUnirse, no pertenecer a otro clan,
// costo 500 créditos (se suman a la bodega del clan).
// Reacciona al inicio y al final.

import fs from 'fs';
import path from 'path';

function loadDB(p){ return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; }
function saveDB(p,o){ fs.writeFileSync(p, JSON.stringify(o, null, 2)); }
function num(n){ return Number(n||0).toLocaleString("es-ES", { maximumFractionDigits: 0 }); }

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // reacción inicial
  await conn.sendMessage(chatId, { react: { text: "✨", key: msg.key } });

  const idArg = args?.[0];
  if (!idArg) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "✳️ Uso: *.unirme <ID del clan>*\nEj: *.unirme 1*", quoted: msg });
  }

  const file = path.join(process.cwd(), "sukirpg.json");
  const db = loadDB(file);
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.clanes   = Array.isArray(db.clanes)   ? db.clanes   : [];

  const user = db.usuarios.find(u => String(u.numero) === String(numero));
  if (!user) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "❌ No estás registrado en el RPG.", quoted: msg });
  }

  // ¿ya está en otro clan?
  const clanActual = db.clanes.find(c => Array.isArray(c.miembros) && c.miembros.some(m => String(m.numero) === String(numero)));
  if (clanActual) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "🚫 Ya perteneces a un clan. Usa *.salirclan* para salir primero.", quoted: msg });
  }

  // Construir la misma lista ordenada que muestra .verclanes para mapear el índice
  const supremo = db.clanes.find(c => c.esSupremo);
  const otros = db.clanes.filter(c => !c.esSupremo).sort((a,b)=>Number(a.creadoEn||0)-Number(b.creadoEn||0));
  const lista = [];
  if (supremo) lista.push(supremo);
  lista.push(...otros);

  const idx = parseInt(idArg, 10);
  if (!Number.isFinite(idx) || idx < 1 || idx > lista.length) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "❌ ID de clan inválido.", quoted: msg });
  }

  const clan = lista[idx - 1];
  clan.miembros = Array.isArray(clan.miembros) ? clan.miembros : [];

  // Validar nivel mínimo
  const minNivel = Number(clan.minNivelParaUnirse || 1);
  const nivelUser = Number(user.nivel || 1);
  if (nivelUser < minNivel) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `🚫 Tu nivel es insuficiente para unirte a *${clan.nombre}*.\nRequerido: *${minNivel}* • Tu nivel: *${nivelUser}*`,
      quoted: msg
    });
  }

  // Cobro 500 créditos
  const costo = 500;
  const saldo = Number(user.creditos || 0);
  if (saldo < costo) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Saldo insuficiente. Se requieren *${num(costo)}* créditos para unirse.\nTu saldo: *${num(saldo)}*`,
      quoted: msg
    });
  }

  // Aplicar
  user.creditos = saldo - costo;
  clan.bodegaCreditos = Number(clan.bodegaCreditos || 0) + costo;
  clan.miembros.push({ numero, rol: "miembro", desde: Date.now() });

  saveDB(file, db);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  return conn.sendMessage(chatId, {
    text:
`✅ Te uniste a *${clan.nombre}* (#${idx})
🎚️ Tu nivel: *${nivelUser}*
💵 Cuota: *${num(costo)}* (depositada en la bodega)
🧰 Bodega del clan ahora: *${num(clan.bodegaCreditos)}*`,
    quoted: msg
  });
};

handler.command = ["unirme"];
export default handler;
