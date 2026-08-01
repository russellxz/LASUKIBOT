// sesiones.js — UNA sola conversación de menú abierta por persona.
//
// El bot tiene tres menús que se contestan con números: los *set* de ventas,
// el panel de *totalventas* y la personalización (*setmenu*). Cada uno escucha
// los mensajes por su cuenta, así que antes cada uno llevaba su propia lista de
// conversaciones abiertas y se pisaban entre ellos: el mismo "3" disparaba dos
// menús a la vez, uno guardaba lo que era del otro, y al pasar del grupo al
// privado quedaban las dos vivas.
//
// Aquí la conversación abierta vive en UN solo sitio. Al abrir cualquier menú
// se cierra automáticamente lo que hubiera antes, sea del menú que sea, y cada
// menú solo atiende lo que es suyo y en el chat donde se abrió.

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** Mismo criterio en todo el bot: México lleva el 1 después del 52 */
function normalizar(entrada) {
  let n = DIGITS(String(entrada || "").split(":")[0]);
  if (!n) return "";
  if (n.startsWith("52") && n.length === 12) n = `521${n.slice(2)}`;
  return n;
}

/** Quién es el bot: el subbot si lo es, y si no el principal */
export function duenoDe(conn) {
  return String(conn?.subbotNumber || conn?.user?.id || "main");
}

/**
 * Todas las formas en las que puede llegar el número de quien escribe.
 *
 * Los listeners de los menús se enganchan ANTES de que el bot resuelva los
 * @lid, así que la misma persona llega como @lid cuando responde y con su
 * número real cuando ejecuta el comando. Si la conversación se guardara con
 * una sola forma, al responder con un número no se encontraría y el bot se
 * quedaría callado.
 */
export function identidades(conn, msg) {
  const out = [];
  const add = (v) => {
    const n = normalizar(v);
    if (n && !out.includes(n)) out.push(n);
  };

  // ⚠️ Si el mensaje lo mandó el propio bot, quien escribe es el bot y punto.
  // En un privado el remoteJid de un mensaje SALIENTE es el del otro, así que
  // sumarlo aquí hacía que el bot se tomara por el admin y se contestara solo.
  if (msg?.key?.fromMe) {
    add(conn?.user?.id);
    return out;
  }

  add(msg?.realNumber);
  add(msg?.realJid);
  // El @lid que el bot ya resolvió al recibir el mensaje. Es lo que hace que
  // la conversación abierta con el comando se encuentre luego cuando la
  // persona responde y WhatsApp manda su @lid, sin depender de que el mapa de
  // LIDs lo tenga cacheado.
  add(msg?.realLid);
  add(msg?.key?.participant);
  if (!String(msg?.key?.remoteJid || "").endsWith("@g.us")) add(msg?.key?.remoteJid);

  // Un @lid resuelto con el mapa que el bot va llenando
  for (const j of [msg?.realJid, msg?.key?.participant, msg?.key?.remoteJid]) {
    if (typeof j === "string" && j.endsWith("@lid") && global.lidMap instanceof Map) {
      add(global.lidMap.get(j));
    }
  }
  return out;
}

// ------------------------------------------------------------
// La conversación abierta
// ------------------------------------------------------------
// Una persona = una conversación. La misma sesión se guarda bajo todas las
// formas de su número, para encontrarla llegue como llegue.
const abiertas = new Map();   // "bot|numero" -> sesión (la misma para varias claves)

export const ESPERA_MS = 10 * 60 * 1000;   // 10 minutos sin decir nada y se cierra sola

/**
 * El chat con el que se guarda la conversación.
 *
 * En los privados NO se puede usar el jid tal cual: el bot reescribe los @lid
 * a número real, pero eso pasa DESPUÉS de estos listeners. Así, el comando veía
 * "50712345678@s.whatsapp.net" y la respuesta "9988@lid", no coincidían y el
 * menú no reaccionaba. Un privado es siempre la misma persona, basta marcarlo.
 */
export function chatDeSesion(chat) {
  const c = String(chat || "");
  return c.endsWith("@g.us") ? c : "privado";
}

function clavesDe(bot, numeros) {
  const out = [];
  for (const n of numeros || []) {
    const d = normalizar(n);
    if (!d) continue;
    const k = `${bot}|${d}`;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function olvidar(sesion) {
  for (const k of sesion?.claves || []) abiertas.delete(k);
}

function limpiarViejas() {
  const ahora = Date.now();
  for (const [k, s] of abiertas) {
    if (ahora - s.ts > ESPERA_MS) abiertas.delete(k);
  }
}

/**
 * Abre (o mueve) la conversación de esta persona.
 *
 * Cierra siempre lo que tuviera antes, sea del menú que sea y del chat que
 * sea: es lo que impide que dos menús contesten al mismo número.
 *
 * @param menu    "ventas" | "panel" | "setmenu"
 * @param chat    dónde sigue la conversación (un grupo, o el privado)
 */
export function abrirMenu(menu, bot, numeros, chat, datos = {}) {
  limpiarViejas();
  cerrarMenu(bot, numeros);

  const claves = clavesDe(bot, numeros);
  if (!claves.length) return null;

  const sesion = { menu, chat: chatDeSesion(chat), datos: { ...datos }, ts: Date.now(), claves };
  for (const k of claves) abiertas.set(k, sesion);
  return sesion;
}

/** La conversación abierta de esta persona, sea del menú que sea */
export function sesionDe(bot, numeros) {
  for (const k of clavesDe(bot, numeros)) {
    const s = abiertas.get(k);
    if (!s) continue;
    if (Date.now() - s.ts > ESPERA_MS) {
      olvidar(s);
      continue;
    }
    return s;
  }
  return null;
}

/**
 * Lo que este menú tenía a medias con esta persona.
 * Devuelve null si la conversación abierta es de otro menú o de otro chat, así
 * un menú nunca se queda con lo que era del otro.
 */
export function leerMenu(menu, bot, numeros, chatActual) {
  const s = sesionDe(bot, numeros);
  if (!s || s.menu !== menu) return null;
  if (s.chat !== chatDeSesion(chatActual)) return null;
  return s.datos;
}

/** Cierra lo que tuviera abierto esta persona, esté donde esté */
export function cerrarMenu(bot, numeros) {
  for (const k of clavesDe(bot, numeros)) {
    const s = abiertas.get(k);
    if (s) olvidar(s);
    else abiertas.delete(k);
  }
}

/** Qué menú tiene abierto ahora mismo ("ventas", "panel", "setmenu" o null) */
export function menuAbierto(bot, numeros) {
  return sesionDe(bot, numeros)?.menu || null;
}

// ------------------------------------------------------------
// ¿Es un comando del bot?
// ------------------------------------------------------------
/**
 * Un comando escrito en medio de una configuración NO es contenido.
 *
 * Antes, si estabas en "escribe el texto" y escribías *.totalventas*, el menú
 * guardaba ".totalventas" como texto del producto. Y al revés: el panel te
 * ponía la tienda ".setnetflix". Con esto el comando se deja pasar tal cual
 * para que lo atienda el bot, y el menú no lo toca.
 */
export function esComandoDelBot(texto) {
  const t = String(texto || "").trim();
  if (!t) return false;

  const primera = t.split(/\s+/)[0] || "";
  const prefijos =
    Array.isArray(global.prefixes) && global.prefixes.length ? global.prefixes : ["."];

  const p = prefijos.find((x) => x && primera.startsWith(x));
  if (!p) return false;

  const nombre = primera.slice(p.length).toLowerCase();
  if (!nombre) return false;

  if (global.pluginIndex?.has?.(nombre)) return true;
  return (global.plugins || []).some((pl) =>
    (Array.isArray(pl?.command) ? pl.command : []).some(
      (c) => String(c).toLowerCase() === nombre
    )
  );
}

// ------------------------------------------------------------
// Mensajes ya atendidos
// ------------------------------------------------------------
// WhatsApp puede entregar el mismo mensaje más de una vez. Sin esto, un "5"
// repetido se comía el paso siguiente: el primero abría "escribe el nombre" y
// el segundo guardaba "5" como nombre.
// Se apunta por BOT: en un proceso con subbots el mismo mensaje le llega a
// varios, y cada uno tiene que poder atenderlo por su cuenta.
const vistos = new Map();   // "menú|bot|id" -> cuándo

// ------------------------------------------------------------
// Mensajes que mandó el propio bot
// ------------------------------------------------------------
// Cada menú apuntaba solo los SUYOS, así que el panel contestaba a los del set
// y el set a los del panel: 225 mensajes en bucle. Ahora la lista es común.
const propios = new Set();

export function recordarPropio(res) {
  const id = res?.key?.id;
  if (!id) return res;
  propios.add(id);
  if (propios.size > 1500) {
    const it = propios.values();
    for (let i = 0; i < 750; i++) propios.delete(it.next().value);
  }
  return res;
}

export function esMensajePropio(msg) {
  return !!(msg?.key?.id && propios.has(msg.key.id));
}

// ------------------------------------------------------------
// Freno de spam
// ------------------------------------------------------------
// Último seguro: si un menú contesta demasiadas veces seguidas al mismo
// usuario es que algo se está retroalimentando. Se corta y se cierra solo.
const ritmo = new Map();   // "menú|bot|usuario" -> [tiempos]

// Holgado a propósito: configurar de verdad puede llevar muchas respuestas
// seguidas. Nadie escribe 60 mensajes en un minuto, pero un bucle llega ahí
// en menos de un segundo.
const VENTANA_MS = 60 * 1000;
const MAX_RESPUESTAS = 60;

export function frenoDeSpam(nombre, bot, usuario) {
  const clave = `${nombre}|${bot}|${usuario}`;
  const ahora = Date.now();
  const tiempos = (ritmo.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  tiempos.push(ahora);
  ritmo.set(clave, tiempos);

  if (ritmo.size > 2000) {
    for (const [k, v] of ritmo) if (!v.length || ahora - v[v.length - 1] > VENTANA_MS) ritmo.delete(k);
  }
  return tiempos.length > MAX_RESPUESTAS;
}

export function limpiarFreno(nombre, bot, usuario) {
  ritmo.delete(`${nombre}|${bot}|${usuario}`);
}

export function yaAtendido(nombre, msg, bot = "main") {
  const id = msg?.key?.id;
  if (!id) return false;

  const clave = `${nombre}|${bot}|${id}`;
  const ahora = Date.now();
  if (vistos.has(clave)) return true;

  vistos.set(clave, ahora);
  if (vistos.size > 3000) {
    for (const [k, t] of vistos) {
      if (ahora - t > 10 * 60 * 1000) vistos.delete(k);
      if (vistos.size <= 1500) break;
    }
  }
  return false;
}

// ------------------------------------------------------------
// Compatibilidad con la versión anterior
// ------------------------------------------------------------
// Antes cada menú se apuntaba aquí con su forma de cerrarse y al abrir uno se
// cerraban los demás. Ya no hace falta: la conversación es una sola, así que
// abrirla ya cierra lo anterior. Se dejan por si algún plugin viejo los llama.
export function registrarSesion() {}
export function abrirSesion() {}
