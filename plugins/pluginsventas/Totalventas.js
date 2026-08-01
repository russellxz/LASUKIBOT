// plugins/pluginsventas/Totalventas.js — Panel de control de las ventas.
//
// Muestra qué cliente tiene qué producto, cuánto falta para su próxima
// factura, cuánto se ha ganado, y deja cancelar o borrar ventas y poner el
// nombre y el logo de la tienda que salen en las facturas.
//
// En el grupo enseña ese grupo. En privado, si eres owner, primero eliges
// de qué grupo quieres ver la información.

import {
  DIGITS,
  getTienda,
  editarTienda,
  gruposConTienda,
  resumen,
  ventasActivas,
  facturasPendientes,
  cancelarVenta,
  borrarVenta,
  textoCiclo,
  tiempoRestante,
  fecha
} from "../../facturacion-core.js";
import { isAdminByNumber, isOwnerCheck, numeroDelRemitente } from "../../libs/adminCheck.js";
import { identidades } from "../../ventas-core.js";

const ESPERA_MS = 10 * 60 * 1000;
const pendientes = new Map();
const idsPropios = new Set();

// Igual que en ventas-core: este listener corre antes de que el bot resuelva
// los @lid, así que el panel se guarda y se busca con todas las formas del
// número. Si no, al responder el número no encontraría el panel abierto.
const clavesDe = (conn, msg) =>
  identidades(conn, msg).map((n) => `${conn?.user?.id || "main"}|${msg.key.remoteJid}|${n}`);

function setPendiente(conn, msg, datos) {
  const ahora = Date.now();
  for (const [k, v] of pendientes) if (ahora - v.ts > ESPERA_MS) pendientes.delete(k);
  const ks = clavesDe(conn, msg);
  const p = { ...datos, ts: ahora, __claves: ks };
  for (const k of ks) pendientes.set(k, p);
}

function getPendiente(conn, msg) {
  for (const k of clavesDe(conn, msg)) {
    const p = pendientes.get(k);
    if (!p) continue;
    if (Date.now() - p.ts > ESPERA_MS) {
      for (const x of p.__claves || [k]) pendientes.delete(x);
      return null;
    }
    return p;
  }
  return null;
}

const borrarPendiente = (conn, msg) => {
  for (const k of clavesDe(conn, msg)) {
    const p = pendientes.get(k);
    for (const x of p?.__claves || [k]) pendientes.delete(x);
  }
};

function recordar(res) {
  if (res?.key?.id) {
    idsPropios.add(res.key.id);
    if (idsPropios.size > 400) {
      const it = idsPropios.values();
      for (let i = 0; i < 200; i++) idsPropios.delete(it.next().value);
    }
  }
  return res;
}

const responder = async (conn, msg, text, extra = {}) =>
  recordar(await conn.sendMessage(msg.key.remoteJid, { text, ...extra }, { quoted: msg }));

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

const textoDe = (msg) => {
  const m = desenvolver(msg?.message) || {};
  return String(
    m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || ""
  );
};

function imagenDe(msg) {
  const m = desenvolver(msg?.message) || {};
  if (m.imageMessage) return m.imageMessage;
  const q = m.extendedTextMessage?.contextInfo?.quotedMessage;
  return q ? desenvolver(q)?.imageMessage || null : null;
}

async function aBase64(conn, nodo) {
  const WA = conn?.wa || global?.wa;
  if (!WA?.downloadContentFromMessage) throw new Error("sin descargador");
  const stream = await WA.downloadContentFromMessage(nodo, "image");
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer.length ? buffer.toString("base64") : null;
}

// ------------------------------------------------------------
// Textos del panel
// ------------------------------------------------------------
async function nombreGrupo(conn, chatId) {
  try {
    const meta = await conn.groupMetadata(chatId);
    return meta?.subject || chatId;
  } catch {
    return chatId;
  }
}

function textoPanel(chatId, tituloGrupo) {
  const r = resumen(chatId);
  return [
    `📊 *TOTAL VENTAS*`,
    `🏘️ ${tituloGrupo}`,
    ``,
    `🏪 Tienda: *${r.nombre || "sin nombre"}*`,
    `🖼️ Logo: ${r.logo ? "puesto ✅" : "sin poner"}`,
    ``,
    `💰 Ganancias totales: *${r.ganancias}* créditos`,
    `👥 Clientes activos: *${r.clientes}*`,
    `📦 Ventas activas: *${r.ventasActivas}*`,
    `🧾 Facturas: *${r.facturasPagadas}* pagadas · *${r.facturasPendientes}* pendientes`,
    `🔔 Avisos configurados: *${r.avisos}*`,
    ``,
    Object.keys(r.productos).length
      ? `*Por producto:*\n` +
        Object.entries(r.productos)
          .map(([p, n]) => `• ${p} → ${n} cliente${n === 1 ? "" : "s"}`)
          .join("\n") +
        `\n`
      : ``,
    `*Responde con el número:*`,
    ``,
    `*1.* 👥 Clientes y sus productos`,
    `*2.* 🧾 Facturas pendientes`,
    `*3.* ❌ Cancelar una venta`,
    `*4.* 🗑️ Borrar una venta`,
    `*5.* 🏪 Nombre de la tienda`,
    `*6.* 🖼️ Logo de la tienda`,
    `*0.* 🚪 Salir`
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function listaClientes(chatId) {
  const activas = ventasActivas(chatId);
  if (!activas.length) return "👥 *CLIENTES*\n\n_Todavía no hay ninguna venta activa._";

  const lineas = activas.map((v, i) =>
    [
      `*${i + 1}.* 👤 +${v.cliente}`,
      `     📦 ${v.producto}  ·  💵 ${v.precio} créditos`,
      `     🔁 ${textoCiclo(v.ciclo)}`,
      `     ⏳ Próxima factura ${tiempoRestante(v.proxima)}`,
      `     💰 Lleva pagado ${v.totalPagado || 0} en ${v.pagos || 0} cobro(s)`
    ].join("\n")
  );
  return `👥 *CLIENTES Y SUS PRODUCTOS*\n\n${lineas.join("\n\n")}`;
}

function listaPendientes(chatId) {
  const f = facturasPendientes(chatId);
  if (!f.length) return "🧾 *FACTURAS PENDIENTES*\n\n_Ninguna. Todo al día ✅_";
  return (
    `🧾 *FACTURAS PENDIENTES*\n\n` +
    f
      .map(
        (x, i) =>
          `*${i + 1}.* N.º ${x.numero} · 👤 +${x.cliente}\n` +
          `     📦 ${x.producto} · 💵 ${x.monto} créditos\n` +
          `     📅 ${fecha(x.generada)}`
      )
      .join("\n\n")
  );
}

function listaVentasNumeradas(chatId, titulo, aviso) {
  const activas = ventasActivas(chatId);
  if (!activas.length) return null;
  return (
    `${titulo}\n\n` +
    activas
      .map((v, i) => `*${i + 1}.* 👤 +${v.cliente} · 📦 ${v.producto} · 💵 ${v.precio}`)
      .join("\n") +
    `\n\n${aviso}\n❌ Escribe *cancelar* para salir.`
  );
}

// ------------------------------------------------------------
// Apertura del panel
// ------------------------------------------------------------
async function abrirPanel(conn, msg, chatId) {
  setPendiente(conn, msg, { paso: "menu", grupo: chatId });
  return responder(conn, msg, textoPanel(chatId, await nombreGrupo(conn, chatId)));
}

async function elegirGrupo(conn, msg) {
  const grupos = gruposConTienda();
  if (!grupos.length) {
    return responder(
      conn,
      msg,
      "📊 *TOTAL VENTAS*\n\nTodavía no hay ninguna tienda configurada en ningún grupo."
    );
  }

  const nombres = [];
  for (const g of grupos) nombres.push(await nombreGrupo(conn, g));

  setPendiente(conn, msg, { paso: "grupo", grupos });
  return responder(
    conn,
    msg,
    `📊 *TOTAL VENTAS*\n\n*¿De qué grupo quieres ver la información?*\n\n` +
      grupos.map((g, i) => `*${i + 1}.* ${nombres[i]}`).join("\n") +
      `\n\n❌ Escribe *cancelar* para salir.`
  );
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const quien = numeroDelRemitente(msg);

  if (chatId.endsWith("@g.us")) {
    let permitido = !!msg.key.fromMe;
    for (const n of identidades(conn, msg)) {
      if (permitido) break;
      permitido = isOwnerCheck(n) || (await isAdminByNumber(conn, chatId, n));
    }
    if (!permitido) {
      return responder(conn, msg, "🚫 Solo administradores u owners pueden ver el panel de ventas.");
    }
    return abrirPanel(conn, msg, chatId);
  }

  // En privado solo el owner, y eligiendo grupo
  if (!msg.key.fromMe && !identidades(conn, msg).some((n) => isOwnerCheck(n))) {
    return responder(
      conn,
      msg,
      "🚫 En privado este panel es solo para el owner. Úsalo dentro del grupo de tu tienda."
    );
  }
  return elegirGrupo(conn, msg);
};

// ------------------------------------------------------------
// Listener de las respuestas numeradas
// ------------------------------------------------------------
function registrar(conn) {
  if (!conn || conn._totalventasListener) return;
  conn._totalventasListener = true;

  conn.ev.on("messages.upsert", async (ev) => {
    for (const m of ev.messages || []) {
      try {
        if (!m?.message) continue;
        if (idsPropios.has(m.key?.id)) continue;

        const pend = getPendiente(conn, m);
        if (!pend) continue;

        const crudo = textoDe(m);
        const texto = crudo.trim();
        const bajo = texto.toLowerCase();

        if (bajo === "cancelar" || bajo === "salir") {
          borrarPendiente(conn, m);
          await responder(conn, m, "🚪 Panel cerrado.");
          continue;
        }

        // ---------- Elegir grupo (privado) ----------
        if (pend.paso === "grupo") {
          const i = parseInt(texto, 10);
          const grupo = pend.grupos[i - 1];
          if (!grupo) continue;
          await abrirPanel(conn, m, grupo);
          continue;
        }

        const grupo = pend.grupo;
        const volver = async () => {
          setPendiente(conn, m, { paso: "menu", grupo });
          await responder(conn, m, textoPanel(grupo, await nombreGrupo(conn, grupo)));
        };

        // ---------- Menú ----------
        if (pend.paso === "menu") {
          if (!/^\d$/.test(texto)) continue;
          const op = Number(texto);

          if (op === 0) {
            borrarPendiente(conn, m);
            await responder(conn, m, "🚪 Panel cerrado.");
          } else if (op === 1) {
            await responder(conn, m, listaClientes(grupo));
            await volver();
          } else if (op === 2) {
            await responder(conn, m, listaPendientes(grupo));
            await volver();
          } else if (op === 3 || op === 4) {
            const esCancelar = op === 3;
            const lista = listaVentasNumeradas(
              grupo,
              esCancelar ? "❌ *¿QUÉ VENTA CANCELAS?*" : "🗑️ *¿QUÉ VENTA BORRAS?*",
              esCancelar
                ? "La cuenta vuelve al stock y se anulan sus facturas pendientes."
                : "Se borra la venta y todo su historial de facturas."
            );
            if (!lista) {
              await responder(conn, m, "⚠️ No hay ventas activas.");
              await volver();
              continue;
            }
            setPendiente(conn, m, { paso: esCancelar ? "cancelar" : "borrar", grupo });
            await responder(conn, m, lista);
          } else if (op === 5) {
            setPendiente(conn, m, { paso: "nombre", grupo });
            await responder(
              conn,
              m,
              `🏪 *Escribe el nombre de tu tienda.*\n\n` +
                `Es el que sale en las facturas que reciben tus clientes.\n\n` +
                `❌ Escribe *cancelar* para salir.`
            );
          } else if (op === 6) {
            setPendiente(conn, m, { paso: "logo", grupo });
            await responder(
              conn,
              m,
              `🖼️ *Manda el logo de tu tienda.*\n\n` +
                `Sale redondo arriba a la izquierda de cada factura.\n` +
                `Puedes enviarlo directo o responder a una imagen.\n\n` +
                `❌ Escribe *cancelar* para salir.`
            );
          }
          continue;
        }

        // ---------- Cancelar / borrar ----------
        if (pend.paso === "cancelar" || pend.paso === "borrar") {
          const activas = ventasActivas(grupo);
          const i = parseInt(texto, 10);
          const venta = activas[i - 1];
          if (!venta) {
            await responder(conn, m, `⚠️ Elige un número del *1* al *${activas.length}*.`);
            continue;
          }
          if (pend.paso === "cancelar") {
            cancelarVenta(grupo, venta.id);
            await responder(
              conn,
              m,
              `❌ *Venta cancelada.*\n\n👤 +${venta.cliente} · 📦 ${venta.producto}\n` +
                `La cuenta vuelve al stock disponible.`
            );
            try {
              await conn.sendMessage(`${venta.cliente}@s.whatsapp.net`, {
                text:
                  `❌ *SERVICIO CANCELADO*\n\n` +
                  `Tu *${venta.producto}* fue cancelado por la tienda.\n` +
                  `Ya no se te generarán más facturas.`
              });
            } catch {}
          } else {
            borrarVenta(grupo, venta.id);
            await responder(
              conn,
              m,
              `🗑️ *Venta borrada* junto con su historial.\n\n👤 +${venta.cliente} · 📦 ${venta.producto}`
            );
          }
          await volver();
          continue;
        }

        // ---------- Nombre de la tienda ----------
        if (pend.paso === "nombre") {
          if (!texto) continue;
          editarTienda(grupo, (t) => { t.nombre = texto.slice(0, 40); });
          await responder(conn, m, `✅ *Nombre guardado:* ${texto.slice(0, 40)}`);
          await volver();
          continue;
        }

        // ---------- Logo ----------
        if (pend.paso === "logo") {
          const nodo = imagenDe(m);
          if (!nodo) {
            await responder(conn, m, "⚠️ Eso no es una imagen. Manda el logo o escribe *cancelar*.");
            continue;
          }
          let b64 = null;
          try {
            b64 = await aBase64(conn, nodo);
          } catch (e) {
            console.error("[totalventas] error leyendo el logo:", e.message);
          }
          if (!b64) {
            await responder(conn, m, "❌ No se pudo leer la imagen. Inténtalo otra vez.");
            continue;
          }
          editarTienda(grupo, (t) => { t.logo = b64; });
          await responder(conn, m, "✅ *Logo guardado.* Ya sale en tus facturas.");
          await volver();
          continue;
        }
      } catch (e) {
        console.error("[totalventas] error en el listener:", e);
      }
    }
  });
}

handler.command = ["totalventas", "totalventa", "ventastotal"];
handler.help = ["totalventas"];
handler.tags = ["ventas"];
handler.run = registrar;

export default handler;
