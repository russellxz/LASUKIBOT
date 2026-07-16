// plugins/darnivel.js
// Uso (solo owner):
//   .darnivel 30 @user      → fija el nivel en 30
//   .darnivel +5 @user      → aumenta 5 niveles
//   .darnivel -3 @user      → disminuye 3 niveles (mín 1)
// También funciona respondiendo al mensaje del usuario objetivo.

import fs from 'fs';
import path from 'path';

function loadDB(p){ return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; }
function saveDB(p,o){ fs.writeFileSync(p, JSON.stringify(o, null, 2)); }

const handler = async (msg, { conn, args }) => {
  const chatId  = msg.key.remoteJid;
  const sender  = msg.key.participant || msg.key.remoteJid;
  const numero  = (sender || "").replace(/\D/g, "");
  const fromMe  = !!msg.key.fromMe;
  const botID   = (conn.user?.id || "").replace(/\D/g, "");

  // ✅ misma lógica que tu addowner
  if (!global.isOwner?.(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando.",
      quoted: msg
    });
  }

  if (!args?.length) {
    return conn.sendMessage(chatId, {
      text: "✳️ Uso:\n• *.darnivel 30 @user*\n• *.darnivel +5 @user*\n• *.darnivel -3 @user*\n(También puedes responder al usuario objetivo o pasar su número)",
      quoted: msg
    });
  }

  // Parsear valor/ajuste
  const raw = String(args[0]).trim();
  let modo = "set"; // set | add | sub
  let valor = 0;

  if (/^[+]\d+$/.test(raw)) { modo = "add"; valor = parseInt(raw.slice(1), 10); }
  else if (/^[-]\d+$/.test(raw)) { modo = "sub"; valor = parseInt(raw.slice(1), 10); }
  else if (/^\d+$/.test(raw)) { modo = "set"; valor = parseInt(raw, 10); }
  else {
    return conn.sendMessage(chatId, {
      text: "❌ Valor inválido. Usa un número (ej. 30) o +N / -N (ej. +5 / -3).",
      quoted: msg
    });
  }

  if (valor <= 0) {
    return conn.sendMessage(chatId, { text: "❌ El valor debe ser mayor que 0.", quoted: msg });
  }

  // Detectar objetivo: mención, respuesta o número directo
  let targetNum = null;
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (ctx?.mentionedJid?.length) {
    targetNum = ctx.mentionedJid[0].replace(/\D/g, "");
  } else if (ctx?.participant) {
    targetNum = ctx.participant.replace(/\D/g, "");
  }
  if (!targetNum && args.length > 1) {
    const maybeNumber = args[1].replace(/\D/g, "");
    if (maybeNumber) targetNum = maybeNumber;
  }

  if (!targetNum) {
    return conn.sendMessage(chatId, {
      text: "❌ Debes *mencionar*, *responder* o pasar el número del usuario.",
      quoted: msg
    });
  }

  // Cargar DB y buscar usuario
  const file = path.join(process.cwd(), "sukirpg.json");
  const db = loadDB(file);
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

  const user = db.usuarios.find(u => String(u.numero) === String(targetNum));
  if (!user) {
    return conn.sendMessage(chatId, {
      text: "❌ El usuario no está registrado en el RPG.",
      quoted: msg
    });
  }

  const nivelAnterior = Number(user.nivel || 1);
  let nivelNuevo = nivelAnterior;

  if (modo === "set") nivelNuevo = valor;
  if (modo === "add") nivelNuevo = nivelAnterior + valor;
  if (modo === "sub") nivelNuevo = nivelAnterior - valor;

  if (nivelNuevo < 1) nivelNuevo = 1;
  if (nivelNuevo > 9999) nivelNuevo = 9999;

  user.nivel = nivelNuevo;

  // (opcional) auditoría simple
  user.historial = Array.isArray(user.historial) ? user.historial : [];
  user.historial.push({
    evento: "darnivel",
    por: numero,
    modo,
    valor,
    antes: nivelAnterior,
    despues: nivelNuevo,
    fecha: Date.now()
  });

  saveDB(file, db);

  const signo = modo === "add" ? "+" : (modo === "sub" ? "−" : "→");
  const detalle = modo === "set"
    ? `📌 Nivel fijado en *${nivelNuevo}*`
    : `📌 ${signo}${valor}  |  ${nivelAnterior} → *${nivelNuevo}*`;

  await conn.sendMessage(chatId, {
    text:
`✅ *Nivel actualizado*
👤 Usuario: @${targetNum}
${detalle}`,
    mentions: [`${targetNum}@s.whatsapp.net`],
    quoted: msg
  });
};

handler.command = ["darnivel"];
export default handler;
