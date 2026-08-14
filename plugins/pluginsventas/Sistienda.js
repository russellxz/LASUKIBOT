// plugins/pluginsventas/Sistienda.js — Enciende o apaga la tienda del grupo.
//
//   .sistienda        → dice cómo está y qué cambia
//   .sistienda on     → cuentas, precios, créditos y facturas automáticas
//   .sistienda off    → todo a la antigua: foto y texto, y ya
//
// Viene APAGADA en todos los grupos. Quien no la encienda no nota ningún
// cambio: sus comandos de venta siguen funcionando como siempre.

import { tiendaActiva, ponerTienda } from "../../tienda.js";
import { ventasConfiguradas } from "../../ventas-core.js";
import { ventasActivas, facturasPendientes } from "../../facturacion-core.js";
import { isAdminByNumber, isOwnerCheck, numeroDelRemitente } from "../../libs/adminCheck.js";

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  const responder = (text) => conn.sendMessage(chatId, { text }, { quoted: msg });

  if (!chatId.endsWith("@g.us")) {
    return responder("❌ Este comando solo funciona dentro de un grupo.");
  }

  const quien = numeroDelRemitente(msg);
  const permitido =
    !!msg.key.fromMe ||
    isOwnerCheck(quien) ||
    (await isAdminByNumber(conn, chatId, quien));

  if (!permitido) {
    return responder("🚫 Solo administradores u owners pueden encender o apagar la tienda.");
  }

  const activa = tiendaActiva(chatId);
  const opcion = String(args?.[0] || "").trim().toLowerCase();

  // ---------- Sin argumento: se explica ----------
  if (!opcion) {
    return responder(
      [
        `🛒 *SISTEMA DE TIENDA*`,
        ``,
        `Ahora mismo está *${activa ? "ENCENDIDA ✅" : "APAGADA"}* en este grupo.`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `*APAGADA* _(así viene de fábrica)_`,
        ``,
        `Los comandos de venta son carteles de información:`,
        `• *${pref}setnetflix <texto>* — guarda el texto`,
        `• Responde a una *imagen* con *${pref}setnetflix <texto>* — guarda las dos`,
        `• *${pref}netflix* — tus clientes lo ven`,
        ``,
        `Sin cuentas, sin créditos y sin facturas. Simple.`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `*ENCENDIDA*`,
        ``,
        `Se convierte en una tienda de verdad:`,
        `• *${pref}setnetflix* abre un menú por números`,
        `• Agregas cuentas con su precio y cada cuánto se cobran`,
        `• Los clientes compran con *${pref}netflix 1* y reciben los datos en privado`,
        `• Al cumplirse el plazo el bot manda la factura y cobra solo`,
        `• Lo miras todo con *${pref}totalventas*`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `*${pref}sistienda on* — encenderla aquí`,
        `*${pref}sistienda off* — volver a lo de antes`,
        ``,
        `_Es grupo por grupo: encenderla aquí no la enciende en los demás._`,
        `_Y lo que ya tengas guardado no se borra nunca al cambiar de modo._`
      ].join("\n")
    );
  }

  if (!["on", "off", "1", "0"].includes(opcion)) {
    return responder(`✳️ Úsalo así:\n\n*${pref}sistienda on*\n*${pref}sistienda off*`);
  }

  const encender = opcion === "on" || opcion === "1";

  if (encender === activa) {
    return responder(
      `ℹ️ La tienda ya está *${activa ? "encendida" : "apagada"}* en este grupo.`
    );
  }

  // ---------- Apagar con ventas vivas: se avisa, no se borra nada ----------
  let activas = [];
  let pendientes = [];
  try {
    activas = ventasActivas(chatId);
    pendientes = facturasPendientes(chatId);
  } catch {}

  ponerTienda(chatId, encender);

  let configurados = 0;
  try { configurados = ventasConfiguradas(chatId).length; } catch {}

  if (encender) {
    return responder(
      [
        `✅ *TIENDA ENCENDIDA*`,
        ``,
        `A partir de ahora *${pref}set<comando>* abre el menú por números para`,
        `agregar cuentas con su precio y su ciclo de cobro.`,
        ``,
        configurados
          ? `📌 Los *${configurados}* comando(s) que ya tenías configurados siguen igual:\n` +
            `la foto y el texto no se tocan, solo se les suma lo de las cuentas.`
          : `📌 Todavía no tienes nada configurado aquí. Empieza con *${pref}setstock*`,
        ``,
        `*Los primeros pasos:*`,
        `1️⃣ *${pref}setnetflix* → opción *3* para agregar tu primera cuenta`,
        `2️⃣ *${pref}addcredit @cliente 50* → dale saldo a un cliente`,
        `3️⃣ El cliente compra con *${pref}netflix 1*`,
        `4️⃣ Míralo todo en *${pref}totalventas*`,
        ``,
        `_Si no te convence, la apagas con_ *${pref}sistienda off*`
      ].join("\n")
    );
  }

  return responder(
    [
      `✅ *TIENDA APAGADA*`,
      ``,
      `Volvemos a lo de siempre:`,
      `• *${pref}setnetflix <texto>* — guarda el texto`,
      `• Responde a una *imagen* con ese comando — guarda la foto`,
      `• *${pref}netflix* — tus clientes lo ven`,
      ``,
      `Las fotos y los textos que ya tenías siguen tal cual.`,
      activas.length || pendientes.length
        ? `\n⚠️ *OJO:* tenías *${activas.length}* venta(s) activa(s) y ` +
          `*${pendientes.length}* factura(s) sin pagar.\n` +
          `No se borra nada, pero mientras la tienda esté apagada *no se van a\n` +
          `generar ni cobrar facturas*. Todo vuelve a su sitio al encenderla otra vez.`
        : ``,
      ``,
      `_Para encenderla de nuevo:_ *${pref}sistienda on*`
    ]
      .filter((l) => l !== "")
      .join("\n")
  );
};

handler.command = ["sistienda", "sitienda", "tienda"];
handler.help = ["sistienda on/off"];
handler.tags = ["ventas"];

export default handler;
