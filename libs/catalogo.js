// libs/catalogo.js — El catálogo de personajes de anime para .addper3.
//
// Lee catalogo-anime.json y dice cuáles se pueden agregar todavía. Lo que ya
// está en sukirpg.json no vuelve a salir, así que la lista de disponibles se
// calcula sola: no hay que llevar ningún apunte aparte de los agregados.
//
// Si borras un personaje del RPG, vuelve a estar disponible al momento. Eso es
// justo lo que hace que .addper3 reset funcione sin más.

"use strict";

import fs from "fs";
import path from "path";

export const RUTA_CATALOGO = () => path.join(process.cwd(), "catalogo-anime.json");
export const RUTA_RPG = () => path.join(process.cwd(), "sukirpg.json");
export const RUTA_HISTORIAL = () => path.join(process.cwd(), "addper3-historial.json");

// Precio según lo famoso que sea, siguiendo lo que ya hay en sukirpg.json:
// casi todo entre 100k y 150k, unos cuantos por debajo y unos pocos caros.
export const PRECIOS = {
  S: [150000, 260000],   // protagonistas y villanos de peso
  A: [100000, 150000],   // reparto principal
  B: [60000, 100000]     // secundarios
};

/** Deja el nombre comparable: sin emojis, sin guiones, sin mayúsculas. */
export function normName(s = "") {
  return String(s || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function leerJson(ruta, siFalla) {
  try {
    if (!fs.existsSync(ruta)) return siFalla;
    const datos = JSON.parse(fs.readFileSync(ruta, "utf-8"));
    return datos ?? siFalla;
  } catch (e) {
    console.error(`[catalogo] no pude leer ${path.basename(ruta)}:`, e.message);
    return siFalla;
  }
}

/** Todo el catálogo en una lista plana, con su anime al lado. */
export function cargarCatalogo() {
  const crudo = leerJson(RUTA_CATALOGO(), null);
  if (!crudo?.animes) return [];

  const lista = [];

  for (const [anime, personajes] of Object.entries(crudo.animes)) {
    if (!Array.isArray(personajes)) continue;

    for (const p of personajes) {
      // [nombre, emoji, rango, habilidad1, habilidad2]
      if (!Array.isArray(p) || p.length < 5) continue;

      const [nombre, emoji, rango, hab1, hab2] = p;
      if (!nombre || !hab1 || !hab2) continue;

      lista.push({
        anime,
        nombre: String(nombre),
        emoji: String(emoji || "⭐"),
        rango: ["S", "A", "B"].includes(rango) ? rango : "A",
        habilidades: [String(hab1), String(hab2)]
      });
    }
  }

  return lista;
}

/** Los nombres que ya están en el RPG, listos para comparar. */
export function nombresEnRpg() {
  const rpg = leerJson(RUTA_RPG(), {});
  const personajes = Array.isArray(rpg?.personajes) ? rpg.personajes : [];
  return new Set(personajes.map((p) => normName(p?.nombre)));
}

/** Los que todavía se pueden agregar. */
export function disponibles() {
  const ya = nombresEnRpg();
  return cargarCatalogo().filter((p) => !ya.has(normName(p.nombre)));
}

/** Cuántos hay en total, cuántos puestos y cuántos quedan. */
export function resumen() {
  const catalogo = cargarCatalogo();
  const libres = disponibles();
  const rpg = leerJson(RUTA_RPG(), {});

  return {
    enCatalogo: catalogo.length,
    disponibles: libres.length,
    enRpg: Array.isArray(rpg?.personajes) ? rpg.personajes.length : 0,
    animes: new Set(catalogo.map((p) => p.anime)).size
  };
}

/**
 * Saca n personajes al azar de los que quedan, sin repetir.
 * Los más famosos salen antes: primero se barajan los S, luego los A y los B.
 */
export function elegirAlAzar(n = 1, pool = null) {
  const libres = pool || disponibles();
  if (!libres.length) return [];

  const porRango = { S: [], A: [], B: [] };
  for (const p of libres) porRango[p.rango].push(p);

  const barajar = (a) => {
    const c = [...a];
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c;
  };

  return [...barajar(porRango.S), ...barajar(porRango.A), ...barajar(porRango.B)]
    .slice(0, Math.max(1, n));
}

/** Un precio del rango que le toca, redondeado al millar. */
export function precioDe(rango = "A") {
  const [min, max] = PRECIOS[rango] || PRECIOS.A;
  const bruto = min + Math.random() * (max - min);
  return Math.round(bruto / 1000) * 1000;
}

/** Cómo se llama en la tienda: con su emoji delante, como los que ya hay. */
export function nombreDeTienda(p) {
  return `${p.emoji}${p.nombre}`;
}

// ------------------------------------------------------------- guardar y quitar

/** Mete el personaje en sukirpg.json. Devuelve false si ya estaba. */
export function guardarEnRpg(personaje) {
  const ruta = RUTA_RPG();
  const datos = leerJson(ruta, {});

  if (!Array.isArray(datos.personajes)) datos.personajes = [];

  const clave = normName(personaje.nombre);
  if (datos.personajes.some((p) => normName(p?.nombre) === clave)) return false;

  datos.personajes.push(personaje);
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));
  return true;
}

/** Saca del RPG los nombres que se le pasen. Devuelve cuántos quitó. */
export function quitarDelRpg(nombres = []) {
  const ruta = RUTA_RPG();
  const datos = leerJson(ruta, {});
  if (!Array.isArray(datos.personajes)) return 0;

  const fuera = new Set(nombres.map(normName));
  const antes = datos.personajes.length;

  datos.personajes = datos.personajes.filter((p) => !fuera.has(normName(p?.nombre)));

  const quitados = antes - datos.personajes.length;
  if (quitados) fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));

  return quitados;
}

// ------------------------------------------------------------------- historial

/** Las tandas que ha metido .addper3, para poder deshacerlas. */
export function leerHistorial() {
  const h = leerJson(RUTA_HISTORIAL(), { tandas: [] });
  return Array.isArray(h?.tandas) ? h : { tandas: [] };
}

export function apuntarTanda(personajes, porQuien = "") {
  const h = leerHistorial();

  h.tandas.push({
    fecha: new Date().toISOString(),
    por: String(porQuien || "").replace(/[^0-9]/g, ""),
    personajes
  });

  // No hace falta guardar la historia entera del bot.
  if (h.tandas.length > 50) h.tandas = h.tandas.slice(-50);

  fs.writeFileSync(RUTA_HISTORIAL(), JSON.stringify(h, null, 2));
}

/** Quita la última tanda del historial y devuelve lo que tenía dentro. */
export function sacarUltimaTanda() {
  const h = leerHistorial();
  const ultima = h.tandas.pop();

  if (!ultima) return null;

  fs.writeFileSync(RUTA_HISTORIAL(), JSON.stringify(h, null, 2));
  return ultima;
}

/** Borra un personaje suelto del historial (cuando se quita a mano). */
export function olvidarDelHistorial(nombre) {
  const h = leerHistorial();
  const clave = normName(nombre);

  for (const tanda of h.tandas) {
    tanda.personajes = (tanda.personajes || []).filter((p) => normName(p?.nombre) !== clave);
  }

  h.tandas = h.tandas.filter((t) => (t.personajes || []).length);
  fs.writeFileSync(RUTA_HISTORIAL(), JSON.stringify(h, null, 2));
}

export default {
  cargarCatalogo, disponibles, resumen, elegirAlAzar, precioDe, nombreDeTienda,
  guardarEnRpg, quitarDelRpg, leerHistorial, apuntarTanda, sacarUltimaTanda,
  olvidarDelHistorial, normName
};
