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
