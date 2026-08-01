// sesiones.js — Solo puede haber UNA conversación de menú abierta por usuario.
//
// El bot tiene varios menús que se responden con números: los set de ventas,
// el panel de totalventas y la personalización (setmenu). Cada uno escucha los
// mensajes por su cuenta, así que si quedaban dos abiertos a la vez el mismo
// número disparaba los dos y cada uno hacía algo distinto.
//
// Aquí cada menú se apunta con un nombre y su forma de cerrarse. Al abrir uno,
// se cierran todos los demás para ese usuario.

const cerradores = new Map();   // nombre -> función que cierra ese menú

/** Un menú se apunta al abrirse por primera vez */
export function registrarSesion(nombre, cerrar) {
  if (typeof cerrar === "function") cerradores.set(nombre, cerrar);
}

/** Abre el menú `nombre` cerrando los demás que tuviera ese usuario */
export function abrirSesion(nombre, conn, msg) {
  for (const [otro, cerrar] of cerradores) {
    if (otro === nombre) continue;
    try {
      cerrar(conn, msg);
    } catch (e) {
      console.error(`[sesiones] no se pudo cerrar ${otro}:`, e.message);
    }
  }
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
