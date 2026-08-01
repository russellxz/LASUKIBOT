// plugins/pluginsventas/Facturacion.js — El motor de la facturación.
//
// Cada pocos segundos revisa las ventas activas. Cuando a una le toca su
// ciclo genera la factura y la manda:
//   • al CLIENTE por privado, con la imagen de la factura
//   • a los NÚMEROS DE AVISO configurados en el set del producto
//   • si no hay ninguno configurado, al propio grupo, para que la vean los admins
//
// El cliente paga respondiendo a su factura con la palabra *pagar*. Se le
// descuenta de sus créditos y a los números de aviso les llega la confirmación.

import {
  INTERVALO_REVISION_MS,
  getTienda,
  gruposConTienda,
  ventasQueTocanFactura,
  crearFactura,
  pagarFactura,
  pendientesDeCliente,
  getCreditos,
  textoCiclo,
  fecha
} from "../../facturacion-core.js";
import { generarFacturaImagen, textoFactura } from "../../factura-imagen.js";
import { registrarListenerVentas, getProducto, identidades } from "../../ventas-core.js";

// Mensajes de factura que hemos enviado: id del mensaje → dónde vive la factura.
// Sirve para saber a qué factura responde el cliente cuando escribe "pagar".
const mensajesFactura = new Map();

function recordarFactura(res, grupo, facturaId) {
  const id = res?.key?.id;
  if (!id) return;
  mensajesFactura.set(id, { grupo, facturaId });
  if (mensajesFactura.size > 2000) {
    const it = mensajesFactura.keys();
    for (let i = 0; i < 1000; i++) mensajesFactura.delete(it.next().value);
  }
}

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

function textoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return String(
    m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || ""
  ).trim();
}

function citadoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return (
    m.extendedTextMessage?.contextInfo?.stanzaId ||
    m.imageMessage?.contextInfo?.stanzaId ||
    null
  );
}

/** ¿El texto es una orden de pago? */
export function esPalabraDePago(texto) {
  return /^\s*(pagar|pagado|pague|pagué|pago ya)\s*$/i.test(String(texto || ""));
}

const tituloProducto = (clave) => getProducto(clave)?.titulo || clave;

// ------------------------------------------------------------
// Envío de facturas
// ------------------------------------------------------------
async function enviarFactura(conn, grupo, factura) {
  const t = getTienda(grupo);
  const tienda = t.nombre || "Tu tienda";
  const producto = tituloProducto(factura.producto);

  const opciones = {
    tienda,
    producto,
    logo: t.logo ? Buffer.from(t.logo, "base64") : null
  };

  const imagen = await generarFacturaImagen(factura, opciones);
  const caption = textoFactura(factura, opciones);

  // --- Al cliente ---
  const privado = `${factura.cliente}@s.whatsapp.net`;
  try {
    const res = imagen
      ? await conn.sendMessage(privado, { image: imagen, caption })
      : await conn.sendMessage(privado, { text: caption });
    recordarFactura(res, grupo, factura.id);
  } catch (e) {
    console.error(`[factura] no se pudo avisar a +${factura.cliente}:`, e.message);
  }

  // --- A los números de aviso (o al grupo si no hay ninguno) ---
  const avisoTexto =
    `🔔 *FACTURA GENERADA*\n\n` +
    `Tu cliente *+${factura.cliente}* tiene que pagar:\n\n` +
    `📦 ${producto}\n` +
    `💵 ${factura.monto} créditos\n` +
    `🔁 ${textoCiclo(factura.ciclo)}\n` +
    `🔖 Factura N.º ${factura.numero}\n` +
    `📅 ${fecha(factura.generada)}\n\n` +
    `_Se le avisó por privado. Cuando pague te llega la confirmación._`;

  const destinos = (t.avisos || []).map((n) => `${n}@s.whatsapp.net`);
  if (!destinos.length) destinos.push(grupo);

  for (const d of destinos) {
    try {
      if (imagen) await conn.sendMessage(d, { image: imagen, caption: avisoTexto });
      else await conn.sendMessage(d, { text: avisoTexto });
    } catch (e) {
      console.error(`[factura] no se pudo avisar a ${d}:`, e.message);
    }
  }
}

async function avisarPago(conn, grupo, factura) {
  const t = getTienda(grupo);
  const producto = tituloProducto(factura.producto);
  const texto =
    `✅ *FACTURA PAGADA*\n\n` +
    `*+${factura.cliente}* pagó su factura.\n\n` +
    `📦 ${producto}\n` +
    `💵 ${factura.monto} créditos\n` +
    `🔖 Factura N.º ${factura.numero}\n` +
    `📅 ${fecha(Date.now())}`;

  const destinos = (t.avisos || []).map((n) => `${n}@s.whatsapp.net`);
  if (!destinos.length) destinos.push(grupo);

  for (const d of destinos) {
    try { await conn.sendMessage(d, { text: texto }); } catch {}
  }
}

// ------------------------------------------------------------
// Revisión periódica
// ------------------------------------------------------------
async function revisar(conn) {
  for (const grupo of gruposConTienda()) {
    let tocan = [];
    try {
      tocan = ventasQueTocanFactura(grupo);
    } catch (e) {
      console.error("[factura] error revisando", grupo, e.message);
      continue;
    }
    for (const venta of tocan) {
      const factura = crearFactura(grupo, venta.id);
      if (!factura) continue;
      console.log(`🧾 [factura] ${grupo} → ${venta.producto} de +${venta.cliente}`);
      await enviarFactura(conn, grupo, factura);
    }
  }
}

// ------------------------------------------------------------
// Cobro: el cliente responde "pagar"
// ------------------------------------------------------------
async function intentarCobro(conn, msg) {
  const texto = textoDe(msg);
  if (!esPalabraDePago(texto)) return false;

  // Aquí también corremos antes de que el bot resuelva los @lid: probamos
  // todas las formas del número hasta dar con la que tiene la factura.
  const posibles = identidades(conn, msg);
  if (!posibles.length) return false;

  // ¿Responde a una factura concreta?
  const citado = citadoDe(msg);
  let objetivo = citado ? mensajesFactura.get(citado) : null;
  let cliente = null;

  if (objetivo) {
    const t0 = getTienda(objetivo.grupo);
    const f0 = t0.facturas.find((f) => f.id === objetivo.facturaId);
    if (!f0 || !posibles.includes(f0.cliente)) return false;
    cliente = f0.cliente;
  } else {
    // Si no, se cobra la más antigua que tenga pendiente
    for (const n of posibles) {
      const lista = pendientesDeCliente(n);
      if (!lista.length) continue;
      objetivo = { grupo: lista[0].chatId, facturaId: lista[0].factura.id };
      cliente = n;
      break;
    }
    if (!objetivo) return false;
  }

  const t = getTienda(objetivo.grupo);
  const factura = t.facturas.find((f) => f.id === objetivo.facturaId);
  if (!factura || factura.cliente !== cliente) return false;

  const chat = msg.key.remoteJid;
  const responder = (text) => conn.sendMessage(chat, { text }, { quoted: msg });

  if (factura.estado !== "pendiente") {
    await responder("ℹ️ Esa factura ya estaba pagada. No se te cobró de nuevo.");
    return true;
  }

  const r = pagarFactura(objetivo.grupo, factura.id);

  if (r?.error === "sin_creditos") {
    await responder(
      `💳 *NO TIENES CRÉDITOS SUFICIENTES*\n\n` +
        `Esta factura es de *${r.monto}* créditos y tienes *${r.saldo}*.\n\n` +
        `👉 Habla con los administradores del grupo para que te agreguen créditos.\n` +
        `Ellos lo hacen con *addcredit*.\n\n` +
        `Cuando los tengas, vuelve a responder *pagar* a esta factura.`
    );
    return true;
  }
  if (r?.error) {
    await responder("❌ No se pudo procesar el pago. Avisa a un administrador.");
    return true;
  }

  const producto = tituloProducto(factura.producto);
  const opciones = {
    tienda: t.nombre || "Tu tienda",
    producto,
    logo: t.logo ? Buffer.from(t.logo, "base64") : null
  };
  const imagen = await generarFacturaImagen(r.factura, opciones);
  const caption =
    textoFactura(r.factura, opciones) +
    `\n\n💰 Te quedan *${r.saldo}* créditos.` +
    (r.venta ? `\n⏳ Próximo cobro: ${fecha(r.venta.proxima)}` : "");

  try {
    if (imagen) await conn.sendMessage(chat, { image: imagen, caption }, { quoted: msg });
    else await responder(caption);
  } catch {
    await responder(caption);
  }

  await avisarPago(conn, objetivo.grupo, r.factura);
  return true;
}

// ------------------------------------------------------------
// Arranque
// ------------------------------------------------------------
function arrancar(conn) {
  if (!conn) return;

  // Los menús numerados de los set de ventas
  try { registrarListenerVentas(conn); } catch (e) {
    console.error("[factura] no se pudo registrar el listener de ventas:", e.message);
  }

  if (conn._facturacion) return;
  conn._facturacion = true;

  conn.ev.on("messages.upsert", async (ev) => {
    for (const m of ev.messages || []) {
      try {
        if (!m?.message || m.key?.fromMe) continue;
        await intentarCobro(conn, m);
      } catch (e) {
        console.error("[factura] error cobrando:", e.message);
      }
    }
  });

  const tick = async () => {
    try { await revisar(conn); } catch (e) {
      console.error("[factura] error en la revisión:", e.message);
    }
  };

  clearInterval(global.__facturaTimer);
  global.__facturaTimer = setInterval(tick, INTERVALO_REVISION_MS);
  setTimeout(tick, 5000);

  console.log(
    `🧾 [factura] Sistema de facturación activo (revisa cada ${INTERVALO_REVISION_MS / 1000}s).`
  );
}

const handler = async () => {};
handler.run = arrancar;

export default handler;
