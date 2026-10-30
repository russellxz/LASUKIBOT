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

/** Personajes de la tienda que en el catálogo se llaman de otra forma. */
function aliasDelCatalogo() {
  const crudo = leerJson(RUTA_CATALOGO(), null);
  const alias = new Map();

  for (const [enTienda, enCatalogo] of Object.entries(crudo?._alias || {})) {
    alias.set(normName(enTienda), normName(enCatalogo));
  }

  return alias;
}

/** Los nombres que ya están en el RPG, listos para comparar. */
export function nombresEnRpg() {
  const rpg = leerJson(RUTA_RPG(), {});
  const personajes = Array.isArray(rpg?.personajes) ? rpg.personajes : [];
  const alias = aliasDelCatalogo();
  const nombres = new Set();

  // Si en la tienda está "Sukuna", en el catálogo "Ryomen_Sukuna" ya cuenta como puesto.
  for (const p of personajes) {
    const clave = normName(p?.nombre);
    nombres.add(clave);
    if (alias.has(clave)) nombres.add(alias.get(clave));
  }

  return nombres;
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
    porRenovar: porRenovar().length,
    animes: new Set(catalogo.map((p) => p.anime)).size
  };
}

/**
 * ¿Este personaje del catálogo estaba en la tienda antes de vaciarla? Se mira
 * en '_anime_de_la_tienda' (mismo nombre y mismo anime) y en '_alias'.
 */
function estabaEnLaTienda() {
  const crudo = leerJson(RUTA_CATALOGO(), null);
  const anime = new Map();

  for (const [nombre, a] of Object.entries(crudo?._anime_de_la_tienda || {})) {
    anime.set(normName(nombre), a);
  }

  const porAlias = new Set(Object.values(crudo?._alias || {}).map(normName));

  return (p) => {
    const clave = normName(p.nombre);
    return porAlias.has(clave) || anime.get(clave) === p.anime;
  };
}

/**
 * Saca n personajes al azar de los que quedan, sin repetir.
 * Primero los que ya estaban en la tienda antes de vaciarla, y dentro de cada
 * grupo los más famosos antes: se barajan los S, luego los A y los B.
 */
export function elegirAlAzar(n = 1, pool = null) {
  const libres = pool || disponibles();
  if (!libres.length) return [];

  const barajar = (a) => {
    const c = [...a];
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c;
  };

  const porRango = (lista) => {
    const r = { S: [], A: [], B: [] };
    for (const p of lista) r[p.rango].push(p);
    return [...barajar(r.S), ...barajar(r.A), ...barajar(r.B)];
  };

  const estaba = estabaEnLaTienda();
  const antes = libres.filter(estaba);
  const resto = libres.filter((p) => !estaba(p));

  return [...porRango(antes), ...porRango(resto)].slice(0, Math.max(1, n));
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

// ------------------------------------------------- imágenes del CDN viejo

// Los CDN viejos ya no funcionan: las fotos que siguen ahí se ven rotas.
export const CDN_VIEJO = /^https?:\/\/(cdn\.russellxz\.click|cdn\.skyultraplus\.com)\//i;

/** Separa el emoji del principio del nombre: "⚫Sukuna" → ["⚫", "Sukuna"]. */
export function partirNombre(nombre = "") {
  const m = String(nombre).match(/^([^A-Za-z0-9]*)(.*)$/);
  return [m[1], m[2]];
}

/** De qué anime es un personaje de la tienda, para buscarle bien la foto. */
export function animeDe(nombre) {
  const crudo = leerJson(RUTA_CATALOGO(), null);
  const [, limpio] = partirNombre(nombre);

  const fijo = crudo?._anime_de_la_tienda?.[limpio];
  if (fijo) return fijo;

  const alias = aliasDelCatalogo();
  const clave = normName(limpio);
  const buscada = alias.get(clave) || clave;

  return cargarCatalogo().find((p) => normName(p.nombre) === buscada)?.anime || "";
}

/** Los personajes de la tienda que todavía tienen la foto en el CDN viejo. */
export function porRenovar() {
  const rpg = leerJson(RUTA_RPG(), {});
  const personajes = Array.isArray(rpg?.personajes) ? rpg.personajes : [];
  return personajes.filter((p) => CDN_VIEJO.test(String(p?.imagen || "")));
}

/**
 * Cambia la foto vieja por la nueva en todo sukirpg.json: en la tienda y en
 * las copias que ya compraron los usuarios, el banco o la venta. Solo toca lo
 * que tenga exactamente el enlace viejo. Devuelve cuántos cambió.
 */
export function cambiarImagen(urlVieja, urlNueva) {
  const ruta = RUTA_RPG();
  const datos = leerJson(ruta, null);
  if (!datos || !urlVieja) return 0;

  let cambios = 0;
  const recorrer = (nodo) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object") return;

    if (nodo.imagen === urlVieja) {
      nodo.imagen = urlNueva;
      cambios++;
    }

    Object.values(nodo).forEach(recorrer);
  };

  recorrer(datos);
  if (cambios) fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));

  return cambios;
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
  porRenovar, cambiarImagen, animeDe, partirNombre, CDN_VIEJO,
  guardarEnRpg, quitarDelRpg, leerHistorial, apuntarTanda, sacarUltimaTanda,
  olvidarDelHistorial, normName
};
