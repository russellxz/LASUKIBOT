// ventas-core.js — Núcleo de los comandos de ventas.
//
// Cada comando de ventas son en realidad dos:
//   • el que MUESTRA el producto al cliente   (ej. .stock)
//   • el que lo CONFIGURA, solo admins        (ej. .setstock)
//
// El comando de configurar abre un menú numerado (sin botones: se responde
// con el número) desde el que se pone la foto, el texto, se agregan cuentas
// con su precio y su ciclo de facturación, y se eligen los números que
// recibirán las facturas de los clientes.
//
// La foto y el texto se siguen guardando en ventas365.json con el formato de
// siempre, así que lo que ya estaba configurado en los grupos no se pierde.
// Las cuentas, ventas, facturas y créditos viven en facturacion.json.

import fs from "fs";

import {
  isAdminByNumber,
  isOwnerCheck,
  numeroDelRemitente,
  adminNumsDeMeta
} from "./libs/adminCheck.js";
import {
  duenoDe,
  identidades as identidadesDe,
  abrirMenu,
  leerMenu,
  cerrarMenu,
  esComandoDelBot,
  yaAtendido,
  recordarPropio,
  esMensajePropio,
  frenoDeSpam,
  limpiarFreno
} from "./sesiones.js";
import {
  DIGITS,
  normalizarNumero,
  parseCiclo,
  textoCiclo,
  getCuentas,
  cuentasLibres,
  agregarCuenta,
  quitarCuenta,
  cambiarCicloCuenta,
  getAvisos,
  agregarAviso,
  quitarAviso,
  getCreditos,
  editarCuenta,
  textoMargen,
  comprar
} from "./facturacion-core.js";

/**
 * Productos que NO entran en el sistema de cuentas y facturación: ahí solo se
 * pone información (foto y texto). Todo lo de pago va así, porque solo son
 * datos de pago, y también los que se creen con .crear setpago10.
 */
export function esProductoSimple(clave) {
  return /^pagos?\d*$/i.test(String(clave || ""));
}

const ARCHIVO = "./ventas365.json";
const MAX_IMAGEN_MB = 8;

// ------------------------------------------------------------
// Foto y texto (ventas365.json, formato de siempre)
// ------------------------------------------------------------
function leerDatos() {
  if (!fs.existsSync(ARCHIVO)) return {};
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, "utf-8")) || {};
  } catch (e) {
    console.error("[ventas] ventas365.json ilegible:", e.message);
    return {};
  }
}

function guardarDatos(datos) {
  fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2));
}

/** Lo guardado para un comando en un chat concreto (null si no hay nada) */
export function getVenta(chatId, clave) {
  const guardado = leerDatos()?.[chatId]?.[`set${clave}`];
  if (!guardado) return null;
  if (typeof guardado === "string") return { texto: guardado, imagen: null };
  if (!guardado.texto && !guardado.imagen) return null;
  return guardado;
}

function guardarCampo(chatId, clave, campo, valor) {
  const datos = leerDatos();
  if (!datos[chatId]) datos[chatId] = {};
  const actual = datos[chatId][`set${clave}`];
  const base =
    typeof actual === "string" ? { texto: actual, imagen: null } : { ...(actual || {}) };
  base[campo] = valor;
  base.texto ||= "";
  base.imagen ||= null;
  datos[chatId][`set${clave}`] = base;
  guardarDatos(datos);
  return base;
}

/** Comandos de ventas que este chat tiene configurados */
export function ventasConfiguradas(chatId) {
  const delChat = leerDatos()?.[chatId] || {};
  return Object.keys(delChat)
    .filter((k) => k.startsWith("set"))
    .map((k) => k.slice(3));
}

// ------------------------------------------------------------
// Utilidades de mensajes
// ------------------------------------------------------------
function desenvolver(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message ||
    n?.documentWithCaptionMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message ||
      n.documentWithCaptionMessage?.message;
  }
  return n;
}

export function textoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return String(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      ""
  );
}

function contextoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null
  );
}

function textoCitado(msg) {
  const q = contextoDe(msg)?.quotedMessage;
  if (!q) return null;
  const inner = desenvolver(q) || {};
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    null
  );
}

function imagenDe(msg) {
  const m = desenvolver(msg?.message) || {};
  if (m.imageMessage) return m.imageMessage;
  const q = contextoDe(msg)?.quotedMessage;
  return q ? desenvolver(q)?.imageMessage || null : null;
}

function descargador(conn, wa) {
  for (const fuente of [wa, conn?.wa, global?.wa]) {
    if (typeof fuente?.downloadContentFromMessage === "function") return fuente;
  }
  return null;
}

async function aBase64(conn, wa, nodo) {
  const WA = descargador(conn, wa);
  if (!WA) throw new Error("downloadContentFromMessage no disponible");
  const stream = await WA.downloadContentFromMessage(nodo, "image");
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer.length ? buffer.toString("base64") : null;
}

// ------------------------------------------------------------
// Registro de productos (para que el listener sepa de qué habla)
// ------------------------------------------------------------
const PRODUCTOS = new Map();   // clave -> { titulo, emoji, comandos, setComandos }

export function registrarProducto(info) {
  PRODUCTOS.set(info.clave, info);
}

export function getProducto(clave) {
  return PRODUCTOS.get(clave) || null;
}

export function productosRegistrados() {
  return [...PRODUCTOS.values()];
}

/**
 * ¿Ese comando es uno de los "set" de ventas o el panel?
 * El filtro de privados del bot lo usa para dejarlos pasar: cada uno
 * comprueba por su cuenta de qué grupos es admin quien escribe.
 */
export function esComandoDeVentas(nombre) {
  const n = String(nombre || "").toLowerCase().replace(/^[./#!]/, "");
  if (["totalventas", "totalventa", "ventastotal"].includes(n)) return true;
  for (const info of PRODUCTOS.values()) {
    if (info.setComandos?.some((c) => String(c).toLowerCase() === n)) return true;
  }
  return false;
}

// ------------------------------------------------------------
// Estado de los menús abiertos
// ------------------------------------------------------------
// La conversación abierta ya NO vive aquí: vive en sesiones.js, que es común a
// los tres menús. Así es imposible que un set y el panel estén abiertos a la
// vez y que el mismo número dispare los dos.
const idsPropios = new Set();

const dueno = duenoDe;

// Se re-exporta para que los plugins que ya la usaban sigan igual
export const identidades = identidadesDe;

/**
 * Guarda en qué paso va la configuración.
 *
 * Abrirla cierra sola cualquier otra conversación de esta persona, sea del
 * panel, de la personalización o de otro set: por eso ya no se pisan.
 *
 * @param chatDestino  dónde sigue la conversación. Para los datos de las
 *                     cuentas se pasa el privado del admin, así las
 *                     credenciales no se escriben en el grupo.
 */
function setPendiente(conn, msg, datos, chatDestino) {
  abrirMenu(
    "ventas",
    dueno(conn),
    identidades(conn, msg),
    chatDestino || msg?.key?.remoteJid,
    datos
  );
}

/** Lo que este usuario tiene a medias AQUÍ, si es de un set y no de otro menú */
function getPendiente(conn, msg) {
  return leerMenu("ventas", dueno(conn), identidades(conn, msg), msg?.key?.remoteJid);
}

function borrarPendiente(conn, msg) {
  cerrarMenu(dueno(conn), identidades(conn, msg));
}

/** Cierra TODO lo que este usuario tuviera abierto, esté en el chat que esté */
function borrarTodoDelUsuario(conn, msg) {
  cerrarMenu(dueno(conn), identidades(conn, msg));
}

/** Cierra el menú de un set que estuviera abierto para ese usuario */
export function cerrarSesionVentas(conn, msg) {
  borrarTodoDelUsuario(conn, msg);
}

// El plugin de facturación se apunta aquí para poder mandar el comprobante
// de la compra en cuanto alguien compra.
let enviarFacturaFn = null;

export function registrarEnvioFactura(fn) {
  if (typeof fn === "function") enviarFacturaFn = fn;
}

// Ya no hace falta avisar a los otros menús: abrir una conversación cierra la
// anterior por sí sola. Se deja por compatibilidad con quien lo llamara.
export function registrarCerrador() {}

function recordar(res) {
  const id = res?.key?.id;
  if (!id) return res;
  recordarPropio(res);        // lista común de los tres menús
  idsPropios.add(id);
  if (idsPropios.size > 500) {
    const it = idsPropios.values();
    for (let i = 0; i < 250; i++) idsPropios.delete(it.next().value);
  }
  return res;
}

async function responder(conn, msg, texto, extra = {}) {
  return recordar(
    await conn.sendMessage(msg.key.remoteJid, { text: texto, ...extra }, { quoted: msg })
  );
}

// ------------------------------------------------------------
// Permisos
// ------------------------------------------------------------
async function puedeConfigurar(conn, msg, grupo) {
  const chatId = grupo || msg.key.remoteJid;
  if (!chatId.endsWith("@g.us")) return false;
  if (msg.key.fromMe) return true;

  // Se prueban todas las formas del número por lo mismo que en identidades():
  // aquí el admin puede llegar todavía como @lid
  for (const n of identidades(conn, msg)) {
    if (isOwnerCheck(n)) return true;
    if (await isAdminByNumber(conn, chatId, n)) return true;
  }
  return false;
}

/**
 * Grupos en los que está el bot y el usuario es administrador.
 * Sirve para configurar y supervisar todo desde el privado.
 *
 * La lista salía vacía porque aquí se resolvían los admins a mano, y cuando
 * WhatsApp entrega a la gente en @lid y el lidMap todavía no lo tiene cacheado
 * no había forma de reconocerlos. Ahora se usa la MISMA lógica que .cerrar y
 * .abrir (adminNumsDeMeta, que además le pregunta a Baileys), y si con los
 * metadatos de la lista no sale nadie se vuelve a preguntar grupo por grupo.
 */
export async function gruposDondeEsAdmin(conn, msg) {
  const mios = identidades(conn, msg);
  if (!mios.length) return [];

  let todos = {};
  try {
    todos = (await conn.groupFetchAllParticipating?.()) || {};
  } catch (e) {
    console.error("[ventas] no se pudieron listar los grupos:", e.message);
    return [];
  }

  const entradas = Object.entries(todos);
  const salida = [];

  // Primera pasada: con los metadatos que ya tenemos
  for (const [jid, meta] of entradas) {
    const admins = adminNumsDeMeta(conn, meta);
    if (mios.some((n) => admins.has(n))) salida.push({ jid, nombre: meta?.subject || jid });
  }

  // Segunda pasada: si no salió ninguno puede ser que esos metadatos vinieran
  // sin resolver. Se le pregunta al grupo directamente, que es lo que sí
  // acierta con las cuentas en @lid.
  if (!salida.length) {
    for (const [jid, meta] of entradas.slice(0, 60)) {
      let esAdmin = false;
      for (const n of mios) {
        if (esAdmin) break;
        esAdmin = await isAdminByNumber(conn, jid, n);
      }
      if (esAdmin) salida.push({ jid, nombre: meta?.subject || jid });
    }
  }

  return salida.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
}

/**
 * El chat privado de quien escribe, para pedirle ahí las credenciales.
 * Devuelve null si solo tenemos un @lid sin resolver: en ese caso el flujo
 * se queda en el grupo en vez de fallar.
 */
function jidPrivadoDe(conn, msg) {
  const candidatos = [msg?.realJid, msg?.key?.participant, msg?.key?.remoteJid];

  for (const j of candidatos) {
    if (typeof j === "string" && j.endsWith("@s.whatsapp.net")) {
      return `${normalizarNumero(j)}@s.whatsapp.net`;
    }
  }
  for (const j of candidatos) {
    if (typeof j === "string" && j.endsWith("@lid") && global.lidMap instanceof Map) {
      const real = global.lidMap.get(j);
      if (real) return `${normalizarNumero(real)}@s.whatsapp.net`;
    }
  }
  if (msg?.realNumber) return `${normalizarNumero(msg.realNumber)}@s.whatsapp.net`;
  return null;
}

/** El número con el que se le apunta el saldo y las compras a alguien */
function numeroPrincipal(conn, msg) {
  return identidades(conn, msg)[0] || numeroDelRemitente(msg);
}

// ------------------------------------------------------------
// El menú de configuración
// ------------------------------------------------------------
function textoMenuSetSimple(chatId, clave, titulo, emoji, pref) {
  const guardado = getVenta(chatId, clave) || {};
  return [
    `${emoji} *CONFIGURAR ${titulo.toUpperCase()}*`,
    ``,
    `📷 Foto: ${guardado.imagen ? "puesta ✅" : "sin poner"}`,
    `📝 Texto: ${guardado.texto ? "puesto ✅" : "sin poner"}`,
    ``,
    `*Responde a este mensaje con el número:*`,
    ``,
    `*1.* 📷 Poner foto`,
    `*2.* 📝 Poner texto`,
    `*0.* 🚪 Salir`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `ℹ️ Este comando es solo para *información*: pones la foto y el texto y`,
    `los clientes lo ven con *${pref}${clave}*.`,
    `No lleva cuentas ni cobros, porque aquí solo van los datos de pago.`
  ].join("\n");
}

function textoMenuSet(chatId, clave, titulo, emoji, pref) {
  if (esProductoSimple(clave)) {
    return textoMenuSetSimple(chatId, clave, titulo, emoji, pref);
  }
  const guardado = getVenta(chatId, clave) || {};
  const cuentas = getCuentas(chatId, clave);
  const libres = cuentas.filter((c) => !c.vendidaA).length;
  const avisos = getAvisos(chatId);

  return [
    `${emoji} *CONFIGURAR ${titulo.toUpperCase()}*`,
    ``,
    `📷 Foto: ${guardado.imagen ? "puesta ✅" : "sin poner"}`,
    `📝 Texto: ${guardado.texto ? "puesto ✅" : "sin poner"}`,
    `📦 Cuentas: ${cuentas.length} (${libres} libre${libres === 1 ? "" : "s"})`,
    `🔔 Avisos de factura: ${avisos.length} número${avisos.length === 1 ? "" : "s"}`,
    ``,
    `*Responde a este mensaje con el número:*`,
    ``,
    `*1.* 📷 Poner foto`,
    `*2.* 📝 Poner texto`,
    `*3.* ➕ Agregar cuenta  _(te escribo al privado)_`,
    `*4.* ⏱️ Cambiar el ciclo de una cuenta`,
    `*5.* 🔔 Números que reciben TODAS las facturas`,
    `*6.* 🗑️ Quitar una cuenta`,
    `*7.* 👀 Ver las cuentas`,
    `*8.* ✏️ Editar los datos de una cuenta`,
    `*0.* 🚪 Salir`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📖 *CÓMO FUNCIONA*`,
    ``,
    `Si solo pones *foto* y *texto*, con *${pref}${clave}* el cliente ve eso`,
    `y ya está. No hace falta nada más.`,
    ``,
    `Si además agregas *cuentas* (opción 3), se convierte en una venta con`,
    `cobro automático:`,
    ``,
    `1️⃣ Cada cuenta lleva sus datos (correo, contraseña, PIN, perfil...),`,
    `su *precio en créditos* y su *ciclo de cobro*. Esos datos me los pasas`,
    `*por privado*: al elegir la opción 3 te abro la conversación yo, para que`,
    `no queden contraseñas escritas en el grupo.`,
    `2️⃣ El cliente compra con *${pref}${clave} 1* y los datos le llegan a su`,
    `privado. Al grupo nunca.`,
    `3️⃣ Al cumplirse el ciclo, el bot le manda la *factura a su privado* y`,
    `él la paga respondiendo *pagar*. Se le descuenta de sus créditos.`,
    `4️⃣ Los créditos se los das tú con *${pref}addcredit*.`,
    ``,
    `El número de cada factura lo pone el sistema solo, en orden.`,
    `Míralo todo con *${pref}totalventas*.`
  ].join("\n");
}

/** Abre el menú de configuración de un producto para un grupo concreto */
async function abrirMenuSet(conn, msg, info, grupo) {
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  setPendiente(conn, msg, { clave: info.clave, paso: "menu", grupo });
  return responder(conn, msg, textoMenuSet(grupo, info.clave, info.titulo, info.emoji, pref));
}

export async function abrirSetVenta(msg, conn, info) {
  const chatId = msg.key.remoteJid;

  // --- En un grupo: se configura ese grupo ---
  if (chatId.endsWith("@g.us")) {
    if (!(await puedeConfigurar(conn, msg))) {
      return responder(conn, msg, "🚫 Solo administradores u owners pueden usar este comando.");
    }
    return abrirMenuSet(conn, msg, info, chatId);
  }

  // --- En privado: se elige de qué grupo ---
  const grupos = await gruposDondeEsAdmin(conn, msg);

  if (!grupos.length) {
    return responder(
      conn,
      msg,
      `🚫 No eres administrador de ningún grupo donde esté el bot.\n\n` +
        `Usa este comando dentro de tu grupo, o pide que te hagan admin.`
    );
  }

  // Siempre se enseña la lista, aunque sea un solo grupo: así ves de qué grupo
  // se trata antes de tocar nada y empiezas tú poniendo el *1*.
  setPendiente(conn, msg, {
    clave: info.clave,
    paso: "elegir_grupo",
    grupos: grupos.map((g) => g.jid)
  });
  return responder(
    conn,
    msg,
    `${info.emoji} *CONFIGURAR ${info.titulo.toUpperCase()}*\n\n` +
      `*¿En qué grupo?* Responde con el número:\n\n` +
      grupos.map((g, i) => `*${i + 1}.* ${g.nombre}`).join("\n") +
      (grupos.length === 1
        ? `\n\n_Es el único grupo donde eres admin. Responde *1* para empezar._`
        : ``) +
      `\n\n❌ Escribe *cancelar* para salir.`
  );
}

// ------------------------------------------------------------
// Lo que ve el cliente
// ------------------------------------------------------------
function listaCuentasCliente(chatId, clave, pref) {
  if (esProductoSimple(clave)) return null;   // los de pago son solo información
  const libres = cuentasLibres(chatId, clave);
  if (!libres.length) return null;
  return [
    `📦 *CUENTAS DISPONIBLES*`,
    ...libres.map(
      (c, i) =>
        `*${i + 1}.* 💵 ${c.precio} crédito${c.precio === 1 ? "" : "s"} · ${textoCiclo(c.ciclo)}`
    ),
    ``,
    `🛒 Para comprar: *${pref}${clave} 1* (el número de la cuenta)`
  ].join("\n");
}

async function mostrarProducto(msg, conn, info) {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  const guardado = getVenta(chatId, info.clave);
  const lista = listaCuentasCliente(chatId, info.clave, pref);

  if (!guardado && !lista) {
    return responder(
      conn,
      msg,
      `${info.emoji} No hay *${info.titulo}* configurado en este chat.\n\n` +
        `Un admin puede ponerlo con *${pref}set${info.clave}*`
    );
  }

  const partes = [];
  if (guardado?.texto) partes.push(guardado.texto);
  if (lista) {
    partes.push(lista);
    const saldo = getCreditos(chatId, numeroPrincipal(conn, msg));
    partes.push(`💰 Tus créditos: *${saldo}*`);
    if (!saldo) partes.push(`_Pídele créditos a un admin con_ *${pref}addcredit*`);
  }

  const texto = partes.join("\n\n") || `${info.emoji} *${info.titulo}*`;

  if (guardado?.imagen) {
    return recordar(
      await conn.sendMessage(
        chatId,
        { image: Buffer.from(guardado.imagen, "base64"), caption: texto },
        { quoted: msg }
      )
    );
  }
  return responder(conn, msg, texto);
}

async function comprarCuenta(msg, conn, info, indice) {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  const libres = cuentasLibres(chatId, info.clave);
  const cuenta = libres[indice - 1];

  if (!cuenta) {
    return responder(
      conn,
      msg,
      `❌ No existe la cuenta *${indice}*.\n\nMira las disponibles con *${pref}${info.clave}*`
    );
  }

  const cliente = numeroPrincipal(conn, msg);
  const r = comprar(chatId, info.clave, cuenta.id, cliente);

  if (r?.error === "sin_creditos") {
    return responder(
      conn,
      msg,
      `💳 *No te alcanzan los créditos*\n\n` +
        `Esta cuenta cuesta *${r.precio}* y tienes *${r.saldo}*.\n\n` +
        `Pídele a un administrador que te agregue créditos con *${pref}addcredit*`
    );
  }
  if (r?.error === "vendida") {
    return responder(conn, msg, "⚠️ Esa cuenta la acaban de comprar. Mira las que quedan.");
  }
  if (r?.error) {
    return responder(conn, msg, "❌ No se pudo completar la compra.");
  }

  // Los datos de la cuenta van al PRIVADO del cliente, nunca al grupo
  const privado = `${cliente}@s.whatsapp.net`;
  const detalle = [
    `✅ *COMPRA REALIZADA*`,
    ``,
    `📦 *Producto:* ${info.titulo}`,
    `💵 *Pagaste:* ${cuenta.precio} créditos`,
    `💰 *Te quedan:* ${r.saldo} créditos`,
    `🔁 *Se te cobrará:* ${textoCiclo(cuenta.ciclo)}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔐 *DATOS DE TU CUENTA*`,
    ``,
    cuenta.datos,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `🧾 Cuando toque el cobro te llegará una factura aquí mismo.`,
    `Para pagarla responde a la factura escribiendo *pagar*.`,
    ``,
    `⏳ Tendrás *${textoMargen(cuenta.ciclo)}* para pagarla. Si no la pagas`,
    `en ese plazo, el producto se cancela.`
  ].join("\n");

  let entregado = true;
  try {
    await conn.sendMessage(privado, { text: detalle });
  } catch (e) {
    entregado = false;
    console.error("[ventas] no se pudo mandar la cuenta al privado:", e.message);
  }

  // Comprobante de la compra: al cliente y a los números de aviso
  if (r.comprobante && enviarFacturaFn) {
    try {
      await enviarFacturaFn(conn, chatId, r.comprobante);
    } catch (e) {
      console.error("[ventas] no se pudo mandar el comprobante:", e.message);
    }
  }

  return responder(
    conn,
    msg,
    entregado
      ? `✅ *¡Compra hecha!* Te mandé los datos al privado 📩\n\n` +
          `💵 Pagaste *${cuenta.precio}* · 💰 Te quedan *${r.saldo}*\n` +
          `🔁 Próximo cobro ${textoCiclo(cuenta.ciclo)}`
      : `✅ *¡Compra hecha!* Pero no pude escribirte al privado.\n` +
          `Mándame un mensaje por privado y te paso los datos.\n\n` +
          `💵 Pagaste *${cuenta.precio}* · 💰 Te quedan *${r.saldo}*`
  );
}

// ------------------------------------------------------------
// Fábrica de comandos
// ------------------------------------------------------------
/**
 * @param {string}   clave        Nombre bajo el que se guarda (ej. "stock")
 * @param {string[]} comandos     Los que ve el cliente (ej. ["stock"])
 * @param {string[]} setComandos  Los de configurar (ej. ["setstock"])
 * @param {string}   titulo       Nombre bonito para los avisos
 * @param {string}   emoji        Emoji del comando
 */
export function crearVenta({ clave, comandos, setComandos, titulo, emoji = "🛒" }) {
  const info = { clave, comandos, setComandos, titulo, emoji };
  registrarProducto(info);

  const nombres = new Set(comandos.map((c) => c.toLowerCase()));
  const nombresSet = new Set(setComandos.map((c) => c.toLowerCase()));

  const handler = async (msg, { conn, args, command } = {}) => {
    const cmd = String(command || "").toLowerCase();

    if (nombresSet.has(cmd)) return abrirSetVenta(msg, conn, info);
    if (!nombres.has(cmd)) return;

    const n = parseInt(String(args?.[0] || "").trim(), 10);
    if (!esProductoSimple(clave) && Number.isInteger(n) && n > 0) {
      return comprarCuenta(msg, conn, info, n);
    }

    return mostrarProducto(msg, conn, info);
  };

  handler.command = [...comandos, ...setComandos];
  handler.help = [...comandos, ...setComandos];
  handler.tags = ["ventas"];
  handler.ventas = info;

  return handler;
}

// ------------------------------------------------------------
// Listener de los menús numerados
// ------------------------------------------------------------
const MARCAS_PROPIAS = [
  "📷 *Manda ahora",
  "📩 *Te escribí al privado",
  "⚠️ No pude escribirte al privado",
  "📝 *Escribe el texto",
  "➕ *AGREGAR CUENTA",
  "💵 *¿Cuánto cuesta",
  "⏱️ *¿Cada cuánto",
  "⏱️ *¿A qué cuenta",
  "🗑️ *¿Qué cuenta",
  "🔔 *AVISOS DE FACTURA",
  "🔔 *Escribe el número",
  "👀 *CUENTAS DE",
  "✅ *Foto guardada",
  "✅ *Texto guardado",
  "✅ *Cuenta agregada",
  "✅ *Ciclo cambiado",
  "✅ *Cuenta quitada",
  "🚪 Configuración cerrada"
];

const esTextoPropio = (t) =>
  MARCAS_PROPIAS.some((m) => String(t || "").trimStart().startsWith(m)) ||
  /^.{0,3}\*?CONFIGURAR /.test(String(t || "").trimStart());

function pedirCiclo(conn, msg, cabecera) {
  return responder(
    conn,
    msg,
    `${cabecera}\n\n` +
      `Escribe cada cuánto se le cobra al cliente:\n\n` +
      `• *30d* → cada 30 días\n` +
      `• *15d* → cada 15 días\n` +
      `• *7d* → cada 7 días\n` +
      `• *1d* → cada día\n\n` +
      `🧪 *Para probar sin esperar:* usa *m* de minutos.\n` +
      `• *5m* → cada 5 minutos\n` +
      `• *1m* → cada minuto\n\n` +
      `❌ Escribe *volver* para el menú, o *0* para salir.`
  );
}

async function verCuentas(conn, msg, info) {
  const chatId = msg.key.remoteJid;
  const cuentas = getCuentas(chatId, info.clave);
  if (!cuentas.length) {
    return responder(conn, msg, `👀 *CUENTAS DE ${info.titulo.toUpperCase()}*\n\nTodavía no hay ninguna.`);
  }
  const lineas = cuentas.map((c, i) => {
    const estado = c.vendidaA ? `vendida a +${c.vendidaA}` : "libre";
    const primera = String(c.datos || "").split("\n")[0].slice(0, 40);
    return `*${i + 1}.* ${c.vendidaA ? "🔴" : "🟢"} ${estado}\n     💵 ${c.precio} · 🔁 ${textoCiclo(c.ciclo)}\n     _${primera}_`;
  });
  return responder(
    conn,
    msg,
    `👀 *CUENTAS DE ${info.titulo.toUpperCase()}*\n\n${lineas.join("\n\n")}`
  );
}

async function menuAvisos(conn, msg, info) {
  const avisos = getAvisos(msg.key.remoteJid);
  return responder(
    conn,
    msg,
    [
      `🔔 *AVISOS DE FACTURA*`,
      ``,
      avisos.length
        ? avisos.map((n, i) => `*${i + 1}.* +${n}`).join("\n")
        : `_Todavía no hay ningún número._`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📖 *QUÉ ES ESTO*`,
      ``,
      `Los números que pongas aquí reciben *en su privado* TODAS las facturas`,
      `de TODOS los clientes de este grupo:`,
      ``,
      `🧾 Cada factura que se genera (las pendientes de cobro)`,
      `✅ El aviso cada vez que un cliente paga la suya`,
      ``,
      `Es para llevar el control sin tener que estar en el grupo. Sirve para`,
      `*todos los productos* de esta tienda, no solo para este comando.`,
      `Puedes poner todos los números que quieras.`,
      ``,
      `_Si no pones ninguno, las facturas se mandan al grupo._`,
      `_El cliente siempre recibe la suya en su privado, aparte de esto._`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `*Responde con:*`,
      `• *agregar 50712345678* — añadir un número`,
      `• *quitar 50712345678* — sacarlo`,
      `• *volver* — volver al menú`,
      `• *0* — cerrar la configuración`,
      ``,
      `🇲🇽 Si es de México y le falta el *1* después del *52*, se lo pongo yo.`
    ].join("\n")
  );
}

/**
 * Los datos de una cuenta (correo, contraseña, PIN...) NO se escriben en el
 * grupo: el bot le abre la conversación al admin por privado y el resto del
 * paso ocurre ahí. Si no se puede saber su privado, se sigue en el grupo para
 * no dejarlo tirado.
 */
async function pedirCuentaEnPrivado(conn, msg, clave, grupo, aqui, info) {
  const texto =
    `➕ *AGREGAR CUENTA*  ·  ${info.emoji} ${info.titulo}\n\n` +
    `Escribe aquí los datos que recibirá el cliente cuando compre.\n` +
    `Van tal cual los escribas, en varias líneas si quieres:\n\n` +
    `_Ejemplo:_\n` +
    `📧 Correo: cuenta@correo.com\n` +
    `🔑 Contraseña: MiClave123\n` +
    `📌 PIN: 1234\n` +
    `👤 Perfil: 2\n\n` +
    `Después te pregunto el precio y cada cuánto se cobra.\n\n` +
    `❌ Escribe *volver* para el menú, o *0* para salir.`;

  const privado = jidPrivadoDe(conn, msg);

  // Ya estamos en un privado: se sigue aquí mismo. Se mira si NO es grupo, no
  // el jid: antes de normalizarse llega como @lid y no coincidía, así que el
  // bot se mandaba otro mensaje a sí mismo y la segunda cuenta se atascaba.
  const enGrupo = String(msg?.key?.remoteJid || "").endsWith("@g.us");
  if (!enGrupo) {
    setPendiente(conn, msg, { clave, paso: "cuenta_datos", grupo }, aqui);
    return responder(conn, msg, texto);
  }

  if (privado) {
    try {
      recordar(await conn.sendMessage(privado, { text: texto }));
      setPendiente(conn, msg, { clave, paso: "cuenta_datos", grupo }, privado);
      // En el grupo solo queda el aviso, sin ninguna credencial
      return responder(
        conn,
        msg,
        `📩 *Te escribí al privado.*\n\n` +
          `Ponme ahí los datos de la cuenta: no conviene escribir contraseñas\n` +
          `ni PIN en el grupo.\n\n` +
          `_Seguimos por privado. Si luego quieres configurar desde aquí,_\n` +
          `_vuelve a escribir *${(Array.isArray(global.prefixes) && global.prefixes[0]) || "."}set${clave}*._`
      );
    } catch (e) {
      console.log("[ventas] no se pudo abrir el privado del admin:", e.message);
    }
  }

  // Sin privado disponible: se sigue en el grupo, avisando
  setPendiente(conn, msg, { clave, paso: "cuenta_datos", grupo }, aqui);
  return responder(
    conn,
    msg,
    `⚠️ No pude escribirte al privado, así que seguimos por aquí.\n` +
      `_Escríbeme primero por privado y la próxima vez te lo pido allá._\n\n${texto}`
  );
}

/** Se llama una vez por conexión desde el plugin de facturación */
export function registrarListenerVentas(conn) {
  if (conn._ventasListener) return;
  conn._ventasListener = true;

  conn.ev.on("messages.upsert", async (ev) => {
    for (const m of ev.messages || []) {
      try {
        if (!m?.message) continue;
        if (idsPropios.has(m.key?.id) || esMensajePropio(m)) continue;

        const pend = getPendiente(conn, m);
        if (!pend) continue;

        // Último seguro contra bucles: si se contesta demasiado seguido, se
        // corta y se cierra la conversación en vez de llenar el chat.
        const quienEs = identidades(conn, m)[0] || "?";
        if (frenoDeSpam("ventas", dueno(conn), quienEs)) {
          borrarTodoDelUsuario(conn, m);
          limpiarFreno("ventas", dueno(conn), quienEs);
          await responder(
            conn,
            m,
            "🛑 Cerré la configuración: se estaba repitiendo sola.\n\nVuelve a abrirla cuando quieras."
          );
          continue;
        }

        // WhatsApp a veces entrega el mismo mensaje dos veces: el segundo
        // se comería el paso siguiente
        if (yaAtendido("ventas", m, dueno(conn))) continue;

        const crudo = textoDe(m);
        if (esTextoPropio(crudo)) continue;

        const texto = crudo.trim();
        const bajo = texto.toLowerCase();

        // Un comando del bot NO es contenido. Si estabas en "escribe el texto"
        // y escribías *.totalventas*, se guardaba ".totalventas" como texto del
        // producto y encima se abría el panel: los dos a la vez. Ahora el
        // comando se deja pasar tal cual y el menú ni lo mira.
        if (esComandoDelBot(texto)) continue;

        const info = getProducto(pend.clave);
        if (!info) { borrarPendiente(conn, m); continue; }

        // ---------- Elegir grupo (configurando desde privado) ----------
        if (pend.paso === "elegir_grupo") {
          const i = parseInt(texto, 10);
          const grupo = (pend.grupos || [])[i - 1];
          if (!grupo) continue;
          if (!(await puedeConfigurar(conn, m, grupo))) {
            await responder(conn, m, "🚫 No eres administrador de ese grupo.");
            continue;
          }
          await abrirMenuSet(conn, m, info, grupo);
          continue;
        }

        // Solo atendemos a quien puede configurar
        if (!(await puedeConfigurar(conn, m, pend.grupo))) continue;

        // "cancelar" y el 0 cierran SIEMPRE, desde el paso que sea. Antes, si
        // estabas en "manda la foto", el 0 solo contestaba "eso no es una
        // imagen" y no había forma de salir más que escribiendo cancelar.
        if (bajo === "cancelar" || bajo === "salir" || texto === "0") {
          borrarTodoDelUsuario(conn, m);
          await responder(conn, m, "🚪 Configuración cerrada.");
          continue;
        }

        // El producto siempre es el del GRUPO donde se abrió el menú, aunque
        // el admin esté respondiendo desde su privado (opción 3).
        const chatId = pend.grupo || m.key.remoteJid;
        const aqui = m.key.remoteJid;
        const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
        const volverAlMenu = () =>
          setPendiente(conn, m, { clave: pend.clave, paso: "menu", grupo: chatId }, aqui);

        // "volver" sube al menú sin cerrar nada, desde el paso que sea
        if (bajo === "volver" && pend.paso !== "menu") {
          volverAlMenu();
          await responder(
            conn,
            m,
            textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }


        // ---------- Menú principal ----------
        if (pend.paso === "menu") {
          if (!/^\d$/.test(texto)) continue;
          const op = Number(texto);

          // Los de pago solo llevan foto y texto
          if (esProductoSimple(pend.clave) && ![0, 1, 2].includes(op)) {
            await responder(
              conn,
              m,
              `ℹ️ *${info.titulo}* solo lleva foto y texto.\n\n` +
                `Elige *1*, *2* o *0* para salir.`
            );
            continue;
          }

          if (op === 1) {
            setPendiente(conn, m, { clave: pend.clave, paso: "foto", grupo: chatId }, aqui);
            await responder(
              conn,
              m,
              `📷 *Manda ahora la foto* de ${info.titulo}.\n\n` +
                `Puedes enviarla directa o responder a una que ya esté en el chat.\n\n` +
                `❌ Escribe *volver* para el menú, o *0* para salir.`
            );
          } else if (op === 2) {
            setPendiente(conn, m, { clave: pend.clave, paso: "texto", grupo: chatId }, aqui);
            await responder(
              conn,
              m,
              `📝 *Escribe el texto* que verán los clientes con *${pref}${info.clave}*.\n\n` +
                `Puedes usar varias líneas, emojis y negritas.\n\n` +
                `❌ Escribe *volver* para el menú, o *0* para salir.`
            );
          } else if (op === 3) {
            await pedirCuentaEnPrivado(conn, m, pend.clave, chatId, aqui, info);
          } else if (op === 4) {
            const cuentas = getCuentas(chatId, pend.clave);
            if (!cuentas.length) {
              await responder(conn, m, "⚠️ Todavía no hay cuentas. Usa la opción *3* para agregar una.");
              volverAlMenu();
              continue;
            }
            setPendiente(conn, m, { clave: pend.clave, paso: "ciclo_cual", grupo: chatId }, aqui);
            await responder(
              conn,
              m,
              `⏱️ *¿A qué cuenta le cambias el ciclo?*\n\n` +
                cuentas
                  .map(
                    (c, i) =>
                      `*${i + 1}.* ${c.vendidaA ? "🔴 vendida" : "🟢 libre"} · 💵 ${c.precio} · 🔁 ${textoCiclo(c.ciclo)}`
                  )
                  .join("\n") +
                `\n\n❌ Escribe *cancelar* para salir.`
            );
          } else if (op === 5) {
            setPendiente(conn, m, { clave: pend.clave, paso: "avisos", grupo: chatId }, aqui);
            await menuAvisos(conn, m, info);
          } else if (op === 6) {
            const cuentas = getCuentas(chatId, pend.clave);
            if (!cuentas.length) {
              await responder(conn, m, "⚠️ No hay cuentas que quitar.");
              volverAlMenu();
              continue;
            }
            setPendiente(conn, m, { clave: pend.clave, paso: "quitar_cual", grupo: chatId }, aqui);
            await responder(
              conn,
              m,
              `🗑️ *¿Qué cuenta quitas?*\n\n` +
                cuentas
                  .map(
                    (c, i) =>
                      `*${i + 1}.* ${c.vendidaA ? `🔴 vendida a +${c.vendidaA}` : "🟢 libre"} · 💵 ${c.precio}`
                  )
                  .join("\n") +
                `\n\n⚠️ Si está vendida, se cancela la venta del cliente.\n` +
                `❌ Escribe *volver* para el menú, o *0* para salir.`
            );
          } else if (op === 7) {
            await verCuentas(conn, m, info);
            volverAlMenu();
          } else if (op === 8) {
            const cuentas = getCuentas(chatId, pend.clave);
            if (!cuentas.length) {
              await responder(conn, m, "⚠️ Todavía no hay cuentas que editar.");
              volverAlMenu();
              continue;
            }
            setPendiente(conn, m, { clave: pend.clave, paso: "editar_cual", grupo: chatId }, aqui);
            await responder(
              conn,
              m,
              `✏️ *¿QUÉ CUENTA EDITAS?*\n\n` +
                cuentas
                  .map(
                    (c, i) =>
                      `*${i + 1}.* ${c.vendidaA ? `🔴 vendida a +${c.vendidaA}` : "🟢 libre"}\n` +
                      `     💵 ${c.precio} · 🔁 ${textoCiclo(c.ciclo)}\n` +
                      `     _${String(c.datos || "").split("\n")[0].slice(0, 40)}_`
                  )
                  .join("\n\n") +
                `\n\n_Sirve para cambiarle los datos cuando una cuenta se recupera,_\n` +
                `_en vez de borrarla y volver a crearla._\n` +
                `❌ Escribe *volver* para el menú, o *0* para salir.`
            );
          }
          continue;
        }

        // Un número suelto mientras se pide un dato casi siempre es que
        // quisieron pulsar una opción del menú. Se vuelve al menú en vez de
        // guardar "6" como texto o como datos de una cuenta.
        if (
          /^\d$/.test(texto) &&
          ["texto", "cuenta_datos", "editar_datos", "foto"].includes(pend.paso)
        ) {
          volverAlMenu();
          await responder(
            conn,
            m,
            `↩️ *${texto}* es una opción del menú, así que no lo guardé.\n\n` +
              textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }

        // ---------- Foto ----------
        if (pend.paso === "foto") {
          const nodo = imagenDe(m);
          if (!nodo) {
            await responder(conn, m, "⚠️ Eso no es una imagen. Mándala o escribe *cancelar*.");
            continue;
          }
          const tam = Number(nodo.fileLength || 0);
          if (tam && tam > MAX_IMAGEN_MB * 1024 * 1024) {
            await responder(conn, m, `❌ La imagen pesa más de ${MAX_IMAGEN_MB} MB. Manda una más liviana.`);
            continue;
          }
          let b64 = null;
          try {
            b64 = await aBase64(conn, null, nodo);
          } catch (e) {
            console.error("[ventas] error leyendo la foto:", e.message);
          }
          if (!b64) {
            await responder(conn, m, "❌ No se pudo leer la imagen. Inténtalo otra vez.");
            continue;
          }
          guardarCampo(chatId, pend.clave, "imagen", b64);
          volverAlMenu();
          await responder(
            conn,
            m,
            `✅ *Foto guardada.*\n\nYa sale con *${pref}${info.clave}*.\n\n` +
              textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }

        // ---------- Texto ----------
        if (pend.paso === "texto") {
          if (!texto) {
            await responder(conn, m, "⚠️ Escribe algo o *cancelar* para salir.");
            continue;
          }
          guardarCampo(chatId, pend.clave, "texto", crudo.replace(/^\s*\n/, ""));
          volverAlMenu();
          await responder(
            conn,
            m,
            `✅ *Texto guardado.*\n\nYa sale con *${pref}${info.clave}*.\n\n` +
              textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }

        // ---------- Agregar cuenta: datos → precio → ciclo ----------
        if (pend.paso === "cuenta_datos") {
          const datos = (crudo || textoCitado(m) || "").replace(/^\s*\n/, "");
          if (!datos.trim()) {
            await responder(conn, m, "⚠️ Escribe los datos de la cuenta o *cancelar*.");
            continue;
          }
          setPendiente(conn, m, { clave: pend.clave, paso: "cuenta_precio", datos, grupo: chatId }, aqui);
          await responder(
            conn,
            m,
            `💵 *¿Cuánto cuesta esta cuenta?*\n\n` +
              `Escribe solo el número de créditos. Ejemplo: *10*\n\n` +
              `Ese es el precio que se le descuenta al cliente al comprar\n` +
              `y también lo que se le cobra en cada factura.\n\n` +
              `❌ Escribe *volver* para el menú, o *0* para salir.`
          );
          continue;
        }

        if (pend.paso === "cuenta_precio") {
          const precio = Number(texto.replace(",", "."));
          if (!Number.isFinite(precio) || precio < 0) {
            await responder(conn, m, "⚠️ Pon solo un número. Ejemplo: *10*");
            continue;
          }
          setPendiente(conn, m, { clave: pend.clave, paso: "cuenta_ciclo", datos: pend.datos, precio, grupo: chatId }, aqui);
          await pedirCiclo(conn, m, "⏱️ *¿Cada cuánto se le cobra?*");
          continue;
        }

        if (pend.paso === "cuenta_ciclo") {
          const ciclo = parseCiclo(texto);
          if (!ciclo) {
            await responder(conn, m, "⚠️ No entendí el ciclo. Usa *30d* para días o *5m* para minutos.");
            continue;
          }
          const cuenta = agregarCuenta(chatId, pend.clave, {
            datos: pend.datos,
            precio: pend.precio,
            ciclo
          });
          volverAlMenu();
          await responder(
            conn,
            m,
            `✅ *Cuenta agregada.*\n\n` +
              `💵 Precio: *${cuenta.precio}* créditos\n` +
              `🔁 Se cobra: *${textoCiclo(ciclo)}*\n\n` +
              `Los clientes ya la ven con *${pref}${info.clave}* y la compran con *${pref}${info.clave} 1*\n\n` +
              textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }

        // ---------- Cambiar ciclo ----------
        if (pend.paso === "ciclo_cual") {
          const cuentas = getCuentas(chatId, pend.clave);
          const i = parseInt(texto, 10);
          const cuenta = cuentas[i - 1];
          if (!cuenta) {
            await responder(conn, m, `⚠️ Elige un número del *1* al *${cuentas.length}*.`);
            continue;
          }
          setPendiente(conn, m, { clave: pend.clave, paso: "ciclo_nuevo", cuentaId: cuenta.id, grupo: chatId }, aqui);
          await pedirCiclo(conn, m, `⏱️ *¿Cada cuánto se cobra la cuenta ${i}?*`);
          continue;
        }

        if (pend.paso === "ciclo_nuevo") {
          const ciclo = parseCiclo(texto);
          if (!ciclo) {
            await responder(conn, m, "⚠️ No entendí el ciclo. Usa *30d* para días o *5m* para minutos.");
            continue;
          }
          const cuenta = cambiarCicloCuenta(chatId, pend.clave, pend.cuentaId, ciclo);
          volverAlMenu();
          await responder(
            conn,
            m,
            cuenta
              ? `✅ *Ciclo cambiado* a *${textoCiclo(ciclo)}*.\n\n` +
                  `Si la cuenta ya estaba vendida, la próxima factura sale con el ciclo nuevo.\n\n` +
                  textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
              : "❌ Esa cuenta ya no existe."
          );
          continue;
        }

        // ---------- Editar una cuenta ----------
        if (pend.paso === "editar_cual") {
          const cuentas = getCuentas(chatId, pend.clave);
          const i = parseInt(texto, 10);
          const cuenta = cuentas[i - 1];
          if (!cuenta) {
            await responder(conn, m, `⚠️ Elige un número del *1* al *${cuentas.length}*.`);
            continue;
          }
          setPendiente(
            conn, m,
            { clave: pend.clave, paso: "editar_datos", cuentaId: cuenta.id, grupo: chatId },
            aqui
          );
          await responder(
            conn,
            m,
            `✏️ *DATOS NUEVOS DE LA CUENTA ${i}*\n\n` +
              `Así están ahora:\n\n${cuenta.datos}\n\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Escribe los datos nuevos tal cual los quieres.\n` +
              `Si solo quieres cambiarle el precio, escribe *saltar*.\n\n` +
              `❌ Escribe *volver* para el menú, o *0* para salir.`
          );
          continue;
        }

        if (pend.paso === "editar_datos") {
          const datos = bajo === "saltar" ? null : (crudo || "").replace(/^\s*\n/, "");
          if (datos !== null && !datos.trim()) {
            await responder(conn, m, "⚠️ Escribe los datos nuevos o *saltar*.");
            continue;
          }
          setPendiente(
            conn, m,
            { clave: pend.clave, paso: "editar_precio", cuentaId: pend.cuentaId, datos, grupo: chatId },
            aqui
          );
          await responder(
            conn,
            m,
            `💵 *¿Precio nuevo?*\n\n` +
              `Escribe el número de créditos, o *saltar* para dejarlo igual.\n\n` +
              `❌ Escribe *volver* para el menú, o *0* para salir.`
          );
          continue;
        }

        if (pend.paso === "editar_precio") {
          let precio;
          if (bajo !== "saltar") {
            precio = Number(texto.replace(",", "."));
            if (!Number.isFinite(precio) || precio < 0) {
              await responder(conn, m, "⚠️ Pon solo un número, o *saltar* para dejarlo igual.");
              continue;
            }
          }
          const cuenta = editarCuenta(chatId, pend.clave, pend.cuentaId, {
            datos: pend.datos ?? undefined,
            precio
          });
          volverAlMenu();
          await responder(
            conn,
            m,
            cuenta
              ? `✅ *Cuenta actualizada.*\n\n` +
                  `💵 Precio: *${cuenta.precio}* créditos\n` +
                  `🔁 ${textoCiclo(cuenta.ciclo)}\n\n` +
                  `${cuenta.vendidaA ? `El cliente +${cuenta.vendidaA} sigue con esta cuenta, ahora con los datos nuevos.\n\n` : ""}` +
                  textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
              : "❌ Esa cuenta ya no existe."
          );
          continue;
        }

        // ---------- Quitar cuenta ----------
        if (pend.paso === "quitar_cual") {
          const cuentas = getCuentas(chatId, pend.clave);
          const i = parseInt(texto, 10);
          const cuenta = cuentas[i - 1];
          if (!cuenta) {
            await responder(conn, m, `⚠️ Elige un número del *1* al *${cuentas.length}*.`);
            continue;
          }
          quitarCuenta(chatId, pend.clave, cuenta.id);
          volverAlMenu();
          await responder(
            conn,
            m,
            `✅ *Cuenta quitada.*\n\n` +
              textoMenuSet(chatId, pend.clave, info.titulo, info.emoji, pref)
          );
          continue;
        }

        // ---------- Avisos ----------
        if (pend.paso === "avisos") {
          const mAdd = bajo.match(/^agregar\s+(.+)$/);
          const mDel = bajo.match(/^quitar\s+(.+)$/);
          if (mAdd) {
            const n = agregarAviso(chatId, mAdd[1]);
            await responder(
              conn,
              m,
              n ? `✅ Ahora *+${n}* recibirá las facturas de los clientes.` : "⚠️ Ese número no vale."
            );
            await menuAvisos(conn, m, info);
            continue;
          }
          if (mDel) {
            const n = quitarAviso(chatId, mDel[1]);
            await responder(conn, m, n ? `✅ *+${n}* ya no recibirá facturas.` : "⚠️ Ese número no estaba.");
            await menuAvisos(conn, m, info);
            continue;
          }
          continue;
        }
      } catch (e) {
        console.error("[ventas] error en el listener:", e);
      }
    }
  });
}
