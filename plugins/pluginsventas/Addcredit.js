// plugins/pluginsventas/Addcredit.js — Créditos de los clientes.
//
//   .addcredit @cliente 50     → le suma 50 créditos
//   .addcredit 50712345678 50  → igual, por número
//   .addcredit @cliente -20    → le quita 20
//   .addcredit                 → lista quién tiene créditos
//
// Los créditos son por GRUPO: cada grupo es su propia tienda. Con ellos los
// clientes compran las cuentas y pagan sus facturas.

import {
  DIGITS,
  getCreditos,
  sumarCreditos,
  getTienda
} from "../../facturacion-core.js";
import { isAdminByNumber, isOwnerCheck, numeroDelRemitente } from "../../libs/adminCheck.js";

function desenvolver(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.ephemeralMessage?.message
  ) {
    n = n.viewOnceMessage?.message || n.viewOnceMessageV2?.message || n.ephemeralMessage?.message;
  }
  return n;
}

/** A quién va dirigido: mencionado, citado o escrito a mano */
function destinatario(msg, args) {
  const m = desenvolver(msg?.message) || {};
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    null;

  const mencion = ctx?.mentionedJid?.[0];
  if (mencion) return DIGITS(String(mencion).split(":")[0]);

  if (ctx?.participant) return DIGITS(String(ctx.participant).split(":")[0]);

  for (const a of args || []) {
    const n = DIGITS(a);
    if (n.length >= 7) return n;
  }
  return null;
}

/**
 * La cantidad de créditos. Se busca de derecha a izquierda y se descarta el
 * argumento que es el teléfono: si no, ".addcredit 50722222222 50" tomaba el
 * número de teléfono como si fueran los créditos.
 */
function cantidadDe(args, destino) {
  for (let i = (args?.length || 0) - 1; i >= 0; i--) {
    const crudo = String(args[i]).trim();
    if (!/^[+-]?\d{1,7}$/.test(crudo)) continue;   // un teléfono nunca cabe aquí
    if (destino && DIGITS(crudo) === destino) continue;
    const n = Number(crudo);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  const responder = (text) => conn.sendMessage(chatId, { text }, { quoted: msg });

  if (!chatId.endsWith("@g.us")) {
    return responder("❌ Los créditos se manejan por grupo, así que este comando va en el grupo.");
  }

  const quien = numeroDelRemitente(msg);
  const esAdmin =
    msg.key.fromMe || isOwnerCheck(quien) || (await isAdminByNumber(conn, chatId, quien));

  if (!esAdmin) {
    // Un cliente cualquiera puede consultar SU saldo
    const saldo = getCreditos(chatId, quien);
    return responder(
      `💰 *TUS CRÉDITOS*\n\nTienes *${saldo}* crédito${saldo === 1 ? "" : "s"} en este grupo.\n\n` +
        `_Solo los administradores pueden agregar créditos._`
    );
  }

  // Sin argumentos: listado de saldos
  if (!args?.length) {
    const t = getTienda(chatId);
    const filas = Object.entries(t.creditos || {})
      .filter(([, v]) => Number(v) > 0)
      .sort((a, b) => b[1] - a[1]);

    return responder(
      [
        `💰 *CRÉDITOS DEL GRUPO*`,
        ``,
        filas.length
          ? filas.map(([n, v]) => `• +${n} → *${v}*`).join("\n")
          : `_Nadie tiene créditos todavía._`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `*Cómo se usa:*`,
        `• *${pref}addcredit @cliente 50* — le suma 50`,
        `• *${pref}addcredit 50712345678 50* — por número`,
        `• *${pref}addcredit @cliente -20* — le quita 20`,
        ``,
        `Con los créditos los clientes compran las cuentas y pagan sus facturas.`
      ].join("\n")
    );
  }

  const numero = destinatario(msg, args);
  const cantidad = cantidadDe(args, numero);

  if (!numero) {
    return responder(
      `⚠️ ¿A quién?\n\nMenciónalo, responde a su mensaje o pon su número:\n` +
        `*${pref}addcredit @cliente 50*`
    );
  }
  if (!Number.isFinite(cantidad) || cantidad === 0) {
    return responder(
      `⚠️ ¿Cuántos créditos?\n\nEjemplo: *${pref}addcredit @cliente 50*\n` +
        `Para quitar, pon el número en negativo: *-20*`
    );
  }

  const nuevo = sumarCreditos(chatId, numero, cantidad);
  const signo = cantidad > 0 ? "➕" : "➖";

  // Avisarle al cliente por privado, sin romper nada si no se puede
  try {
    await conn.sendMessage(`${numero}@s.whatsapp.net`, {
      text:
        `${signo} *CRÉDITOS ACTUALIZADOS*\n\n` +
        `${cantidad > 0 ? "Te agregaron" : "Te quitaron"} *${Math.abs(cantidad)}* crédito${Math.abs(cantidad) === 1 ? "" : "s"}.\n` +
        `💰 Ahora tienes *${nuevo}*.\n\n` +
        `Ya puedes comprar y pagar tus facturas.`
    });
  } catch {}

  return responder(
    `${signo} *${Math.abs(cantidad)}* crédito${Math.abs(cantidad) === 1 ? "" : "s"} ` +
      `${cantidad > 0 ? "para" : "menos a"} *+${numero}*\n\n💰 Saldo: *${nuevo}*`
  );
};

handler.command = ["addcredit", "addcreditos", "credito", "creditos"];
handler.help = ["addcredit @cliente <cantidad>"];
handler.tags = ["ventas"];

export default handler;
