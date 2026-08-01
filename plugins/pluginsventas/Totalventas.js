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
import {
  identidades,
  getProducto,
  gruposDondeEsAdmin
} from "../../ventas-core.js";
import {
  registrarSesion,
  abrirSesion,
  yaAtendido,
  recordarPropio,
  esMensajePropio,
  frenoDeSpam,
  limpiarFreno
} from "../../sesiones.js";

// Nombre bonito del producto; si es uno creado a mano, su propia clave
const tituloProducto = (clave) => getProducto(clave)?.titulo || clave;

// Este panel entra en el registro compartido de menús: al abrirlo se cierran
// los demás (los set de ventas y la personalización), para que un número no
// dispare dos conversaciones a la vez.
registrarSesion("panel", (conn, msg) => borrarTodoDelUsuario(conn, msg));

const ESPERA_MS = 10 * 60 * 1000;
const pendientes = new Map();
const idsPropios = new Set();

// Igual que en ventas-core: este listener corre antes de que el bot resuelva
// los @lid, así que el panel se guarda y se busca con todas las formas del
// número. Y en los privados no se usa el jid del chat, porque el comando lo ve
// ya normalizado y la respuesta todavía como @lid: la clave no coincidía y el
// panel no reaccionaba al elegir el grupo.
const chatClave = (msg) => {
  const c = String(msg?.key?.remoteJid || "");
  return c.endsWith("@g.us") ? c : "privado";
};

const clavesDe = (conn, msg) =>
  identidades(conn, msg).map((n) => `${conn?.user?.id || "main"}|${chatClave(msg)}|${n}`);

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

/**
 * Cierra el panel que este usuario tuviera abierto en CUALQUIER chat.
 * Si solo se borrara el del chat actual, un panel abierto en el grupo seguía
 * vivo mientras se configuraba por privado y los dos contestaban al mismo
 * número.
 */
const borrarTodoDelUsuario = (conn, msg) => {
  const bot = String(conn?.user?.id || "main");
  const mios = new Set(identidades(conn, msg));
  if (!mios.size) return;

  for (const k of [...pendientes.keys()]) {
    const partes = k.split("|");
    const numero = partes[partes.length - 1];
    if (partes[0] === bot && mios.has(numero)) pendientes.delete(k);
  }
};

function recordar(res) {
  if (res?.key?.id) {
    recordarPropio(res);       // lista común de los tres menús
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

  // Imagen mandada como documento (pasa al enviarla "sin comprimir")
  if (m.documentMessage && /^image\//.test(m.documentMessage.mimetype || "")) {
    return m.documentMessage;
  }

  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null;
  const q = ctx?.quotedMessage ? desenvolver(ctx.quotedMessage) : null;
  if (!q) return null;
  if (q.imageMessage) return q.imageMessage;
  if (q.documentMessage && /^image\//.test(q.documentMessage.mimetype || "")) {
    return q.documentMessage;
  }
  return null;
}

async function aBase64(conn, nodo) {
  // El descargador se inyecta en varios sitios según cómo arranque el bot
  let WA = null;
  for (const fuente of [conn?.wa, global?.wa, conn]) {
    if (typeof fuente?.downloadContentFromMessage === "function") { WA = fuente; break; }
  }
  if (!WA) throw new Error("no hay downloadContentFromMessage disponible");

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
          .map(([p, n]) => `• ${tituloProducto(p)} → ${n} cliente${n === 1 ? "" : "s"}`)
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

const VOLVER = "\n\n━━━━━━━━━━━━━━━━━━━━\n_Responde otro número del menú, o *0* para salir._";

function listaClientes(chatId) {
  const activas = ventasActivas(chatId);
  if (!activas.length) {
    return "👥 *CLIENTES*\n\n_Todavía no hay ninguna venta activa._" + VOLVER;
  }

  const pendientesPorVenta = new Set(
    facturasPendientes(chatId).map((f) => f.ventaId)
  );

  const lineas = activas.map((v, i) =>
    [
      `*${i + 1}.* 👤 +${v.cliente}`,
      `     📦 ${tituloProducto(v.producto)}  ·  💵 ${v.precio} créditos`,
      `     🔁 ${textoCiclo(v.ciclo)}`,
      pendientesPorVenta.has(v.id)
        ? `     🔴 *Tiene una factura sin pagar*`
        : `     ⏳ Próxima factura ${tiempoRestante(v.proxima)}`,
      `     💰 Lleva pagado ${v.totalPagado || 0} en ${v.pagos || 0} cobro(s)`
    ].join("\n")
  );
  return `👥 *CLIENTES Y SUS PRODUCTOS*\n\n${lineas.join("\n\n")}` + VOLVER;
}

function listaPendientes(chatId) {
  const f = facturasPendientes(chatId);
  if (!f.length) return "🧾 *FACTURAS PENDIENTES*\n\n_Ninguna. Todo al día ✅_" + VOLVER;
  return (
    `🧾 *FACTURAS PENDIENTES*\n\n` +
    f
      .map(
        (x, i) =>
          `*${i + 1}.* N.º ${x.numero} · 👤 +${x.cliente}\n` +
          `     📦 ${tituloProducto(x.producto)} · 💵 ${x.monto} créditos\n` +
          `     📅 Emitida ${fecha(x.generada)}\n` +
          `     ⏳ Se cancela si no paga ${tiempoRestante(x.vence)}`
      )
      .join("\n\n") +
    VOLVER
  );
}

function listaVentasNumeradas(chatId, titulo, aviso) {
  const activas = ventasActivas(chatId);
  if (!activas.length) return null;
  return {
    ids: activas.map((v) => v.id),
    texto:
      `${titulo}\n\n` +
      activas
        .map(
          (v, i) =>
            `*${i + 1}.* 👤 +${v.cliente}\n` +
            `     📦 ${tituloProducto(v.producto)} · 💵 ${v.precio} · 🔁 ${textoCiclo(v.ciclo)}`
        )
        .join("\n\n") +
      `\n\n${aviso}\n\n_Responde con el número._\n❌ Escribe *volver* para el panel, o *0* para salir.`
  };
}

// ------------------------------------------------------------
// Apertura del panel
// ------------------------------------------------------------
/** Vuelve al panel sin cerrar la sesión */
async function volverAlPanel(conn, msg, grupo) {
  setPendiente(conn, msg, { paso: "menu", grupo });
  return responder(conn, msg, textoPanel(grupo, await nombreGrupo(conn, grupo)));
}

async function abrirPanel(conn, msg, chatId) {
  abrirSesion("panel", conn, msg);   // que no queden dos conversaciones abiertas
  setPendiente(conn, msg, { paso: "menu", grupo: chatId });
  return responder(conn, msg, textoPanel(chatId, await nombreGrupo(conn, chatId)));
}

async function elegirGrupo(conn, msg) {
  // Todos los grupos donde está el bot y el usuario es admin (el owner, todos)
  let grupos = await gruposDondeEsAdmin(conn, msg);

  // Si no se pudieron listar, al menos los que ya tienen tienda
  if (!grupos.length) {
    const conTienda = gruposConTienda().filter((g) => g.endsWith("@g.us"));
    grupos = [];
    for (const g of conTienda) grupos.push({ jid: g, nombre: await nombreGrupo(conn, g) });
  }

  if (!grupos.length) {
    return responder(
      conn,
      msg,
      "📊 *TOTAL VENTAS*\n\nNo eres administrador de ningún grupo donde esté el bot."
    );
  }

  // Si solo es admin de un grupo, no hay nada que elegir
  if (grupos.length === 1) {
    await responder(conn, msg, `🏘️ Panel de *${grupos[0].nombre}*`);
    return abrirPanel(conn, msg, grupos[0].jid);
  }

  // Marcamos los que ya tienen ventas, para encontrarlos rápido
  const conVentas = new Set(gruposConTienda());

  abrirSesion("panel", conn, msg);
  setPendiente(conn, msg, { paso: "grupo", grupos: grupos.map((g) => g.jid) });
  return responder(
    conn,
    msg,
    `📊 *TOTAL VENTAS*\n\n*¿De qué grupo quieres ver la información?*\n\n` +
      grupos
        .map((g, i) => `*${i + 1}.* ${g.nombre}${conVentas.has(g.jid) ? "  🛒" : ""}`)
        .join("\n") +
      `\n\n_El 🛒 marca los que ya tienen tienda montada._\n` +
      `❌ Escribe *volver* para el panel, o *0* para salir.`
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

  // En privado: se listan los grupos donde el usuario es admin y se elige uno.
  // gruposDondeEsAdmin ya deja pasar al owner con todos los grupos.
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
        if (idsPropios.has(m.key?.id) || esMensajePropio(m)) continue;

        const pend = getPendiente(conn, m);
        if (!pend) continue;

        // Último seguro contra bucles
        const bot = String(conn?.user?.id || "main");
        const quienEs = identidades(conn, m)[0] || "?";
        if (frenoDeSpam("panel", bot, quienEs)) {
          borrarTodoDelUsuario(conn, m);
          abrirSesion("nada", conn, m);
          limpiarFreno("panel", bot, quienEs);
          await responder(
            conn,
            m,
            "🛑 Cerré el panel: se estaba repitiendo solo.\n\nVuelve a abrirlo cuando quieras."
          );
          continue;
        }

        // El mismo mensaje puede llegar dos veces; el segundo se comería el
        // paso siguiente (era lo que hacía que el nombre acabara siendo "5")
        if (yaAtendido("panel", m, conn?.user?.id || "main")) continue;

        const crudo = textoDe(m);
        const texto = crudo.trim();
        const bajo = texto.toLowerCase();

        // "volver" sube al panel sin cerrarlo
        if (bajo === "volver" && pend.paso !== "menu" && pend.grupo) {
          await volverAlPanel(conn, m, pend.grupo);
          continue;
        }

        // "cancelar" y el 0 cierran SIEMPRE, desde el paso que sea: si no,
        // pidiendo el logo el 0 solo contestaba "eso no es una imagen".
        if (bajo === "cancelar" || bajo === "salir" || texto === "0") {
          borrarTodoDelUsuario(conn, m);
          abrirSesion("nada", conn, m);   // y lo que tuviera abierto de otros menús
          await responder(conn, m, "🚪 Panel cerrado.");
          continue;
        }

        // ---------- Elegir grupo (privado) ----------
        if (pend.paso === "grupo") {
          const i = parseInt(texto, 10);
          const grupo = (pend.grupos || [])[i - 1];
          if (!grupo) continue;

          const mios = identidades(conn, m);
          let permitido = !!m.key.fromMe || mios.some((n) => isOwnerCheck(n));
          for (const n of mios) {
            if (permitido) break;
            permitido = await isAdminByNumber(conn, grupo, n);
          }
          if (!permitido) {
            await responder(conn, m, "🚫 No eres administrador de ese grupo.");
            continue;
          }
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

          if (op === 1) {
            setPendiente(conn, m, { paso: "menu", grupo });
            await responder(conn, m, listaClientes(grupo));
          } else if (op === 2) {
            setPendiente(conn, m, { paso: "menu", grupo });
            await responder(conn, m, listaPendientes(grupo));
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
            setPendiente(conn, m, {
              paso: esCancelar ? "cancelar" : "borrar",
              grupo,
              ids: lista.ids
            });
            await responder(conn, m, lista.texto);
          } else if (op === 5) {
            setPendiente(conn, m, { paso: "nombre", grupo });
            await responder(
              conn,
              m,
              `🏪 *Escribe el nombre de tu tienda.*\n\n` +
                `Es el que sale en las facturas que reciben tus clientes.\n\n` +
                `❌ Escribe *volver* para el panel, o *0* para salir.`
            );
          } else if (op === 6) {
            setPendiente(conn, m, { paso: "logo", grupo });
            await responder(
              conn,
              m,
              `🖼️ *Manda el logo de tu tienda.*\n\n` +
                `Sale redondo arriba a la izquierda de cada factura.\n` +
                `Puedes enviarlo directo o responder a una imagen.\n\n` +
                `❌ Escribe *volver* para el panel, o *0* para salir.`
            );
          }
          continue;
        }

        // ---------- Cancelar / borrar ----------
        if (pend.paso === "cancelar" || pend.paso === "borrar") {
          const ids = pend.ids || [];
          const i = parseInt(texto, 10);
          const ventaId = Number.isInteger(i) ? ids[i - 1] : null;
          // Se elige por el id que se enseñó, no por la posición de ahora: si
          // entre medias cambió algo, no se cancela la venta equivocada.
          const venta = ventaId
            ? ventasActivas(grupo).find((v) => v.id === ventaId)
            : null;
          if (!venta) {
            await responder(
              conn,
              m,
              ids.length
                ? `⚠️ Elige un número del *1* al *${ids.length}* de la lista de arriba.`
                : "⚠️ Ya no hay ventas activas."
            );
            continue;
          }
          if (pend.paso === "cancelar") {
            cancelarVenta(grupo, venta.id);
            await responder(
              conn,
              m,
              `❌ *Venta cancelada.*\n\n👤 +${venta.cliente} · 📦 ${tituloProducto(venta.producto)}\n` +
                `La cuenta vuelve al stock disponible y se anularon sus facturas pendientes.`
            );
            try {
              await conn.sendMessage(`${venta.cliente}@s.whatsapp.net`, {
                text:
                  `❌ *SERVICIO CANCELADO*\n\n` +
                  `Tu *${tituloProducto(venta.producto)}* fue cancelado por la tienda.\n` +
                  `Ya no se te generarán más facturas.`
              });
            } catch {}
          } else {
            borrarVenta(grupo, venta.id);
            await responder(
              conn,
              m,
              `🗑️ *Venta borrada* junto con su historial.\n\n👤 +${venta.cliente} · 📦 ${tituloProducto(venta.producto)}`
            );
          }
          await volver();
          continue;
        }

        // ---------- Nombre de la tienda ----------
        if (pend.paso === "nombre") {
          if (!texto) continue;

          // Nadie llama a su tienda "6": es que quisieron pulsar una opción
          if (/^\d$/.test(texto)) {
            await responder(
              conn,
              m,
              `↩️ *${texto}* es una opción del menú, así que no cambié el nombre.\n\n` +
                `Si de verdad quieres que tu tienda se llame así, ponle algo más,\n` +
                `por ejemplo *Tienda ${texto}*.`
            );
            await volver();
            continue;
          }
          editarTienda(grupo, (t) => { t.nombre = texto.slice(0, 40); });
          await responder(conn, m, `✅ *Nombre guardado:* ${texto.slice(0, 40)}`);
          await volver();
          continue;
        }

        // ---------- Logo ----------
        if (pend.paso === "logo") {
          if (/^\d$/.test(texto)) {
            await responder(
              conn,
              m,
              `↩️ *${texto}* es una opción del menú, así que no cambié el logo.`
            );
            await volver();
            continue;
          }
          const nodo = imagenDe(m);
          if (!nodo) {
            await responder(
              conn,
              m,
              "⚠️ Eso no es una imagen.\n\nMándame el logo (o responde a una imagen del chat), o escribe *cancelar*."
            );
            continue;
          }
          let b64 = null;
          try {
            b64 = await aBase64(conn, nodo);
          } catch (e) {
            console.error("[totalventas] error leyendo el logo:", e.message);
          }
          if (!b64) {
            await responder(
              conn,
              m,
              "❌ No pude leer esa imagen.\n\nPrueba a mandarla otra vez, o responde a una que ya esté en el chat."
            );
            continue;
          }
          editarTienda(grupo, (t) => { t.logo = b64; });
          await responder(
            conn,
            m,
            "✅ *Logo guardado.*\n\nYa sale redondo arriba a la izquierda de tus facturas."
          );
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
