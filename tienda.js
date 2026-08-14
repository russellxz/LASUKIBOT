// tienda.js — El interruptor del sistema de tienda, grupo por grupo.
//
// Los comandos de ventas (.netflix, .stock, .combos...) pueden funcionar de
// dos maneras:
//
//   • A LA ANTIGUA (por defecto). El admin escribe *.setnetflix <texto>*, o
//     responde a una imagen con ese comando, y ya está guardado. Los clientes
//     lo ven con *.netflix*. Nada de cuentas, ni créditos, ni facturas.
//
//   • CON TIENDA. Se abre el menú numerado para agregar cuentas con su precio
//     y su ciclo, los clientes compran, y el bot cobra con facturas.
//
// La tienda viene APAGADA en todos los grupos. Quien la quiera, la enciende en
// su grupo con *.sistienda on*.
//
// Se guarda en activos.json, igual de simple que el resto de interruptores del
// bot: { "<id del grupo>": { "tienda": true } }

import fs from "fs";

const ARCHIVO = "./activos.json";

function leer() {
  try {
    if (!fs.existsSync(ARCHIVO)) return {};
    return JSON.parse(fs.readFileSync(ARCHIVO, "utf-8")) || {};
  } catch (e) {
    console.error("[tienda] activos.json ilegible:", e.message);
    return {};
  }
}

function guardar(datos) {
  try {
    fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2));
  } catch (e) {
    console.error("[tienda] no se pudo guardar activos.json:", e.message);
  }
}

/**
 * ¿Está encendida la tienda en este chat?
 * Apagada mientras nadie diga lo contrario: es lo que hace que todo siga
 * funcionando a la antigua sin que nadie tenga que tocar nada.
 */
export function tiendaActiva(chatId) {
  if (!chatId) return false;
  return leer()[String(chatId)]?.tienda === true;
}

/** Enciende o apaga la tienda en un chat. Devuelve cómo quedó. */
export function ponerTienda(chatId, encendida) {
  const id = String(chatId || "");
  if (!id) return false;

  const datos = leer();
  if (encendida) {
    datos[id] = { ...(datos[id] || {}), tienda: true };
  } else if (datos[id]) {
    delete datos[id].tienda;
    if (!Object.keys(datos[id]).length) delete datos[id];
  }
  guardar(datos);
  return !!encendida;
}

/** Los chats que tienen la tienda encendida */
export function gruposConTiendaActiva() {
  const datos = leer();
  return Object.keys(datos).filter((id) => datos[id]?.tienda === true);
}
