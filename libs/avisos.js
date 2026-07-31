// libs/avisos.js — Advertencias manuales (.warn / .unwarn) por usuario y grupo.
//
// Se guardan con la forma:
//
//   { "<grupo>@g.us": { "<numero>": { total: 2, motivos: [...] } } }
//
// Van en su propio warns.json y NO en advertencias.json, porque ese archivo lo
// usan el antilink y el antiárabe guardando un número suelto por usuario. Si
// compartieran sitio se pisarían: el antilink haría Number() sobre esta ficha,
// le saldría NaN y la sustituiría por un número, perdiendo los motivos.
// Además cada uno tiene su límite (antilink 10, warn 3) y mezclarlos cambiaría
// el comportamiento del antilink.
//
// El bot principal usa ./warns.json y cada subbot el suyo dentro de su carpeta,
// para que las advertencias de uno no afecten a las del otro.

"use strict";

import fs from "fs";
import path from "path";

export const AVISOS_MAX = 3;   // al tercero, fuera del grupo

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

/** Dónde guarda sus advertencias esta conexión. */
export function rutaAvisos(conn) {
  if (conn?.subDataDir) return path.join(conn.subDataDir, "warns.json");
  return path.resolve("./warns.json");
}

function leerTodo(conn) {
  try {
    const ruta = rutaAvisos(conn);
    if (!fs.existsSync(ruta)) return {};

    const datos = JSON.parse(fs.readFileSync(ruta, "utf-8"));
    return datos && typeof datos === "object" ? datos : {};
  } catch {
    return {};
  }
}

function guardarTodo(conn, datos) {
  try {
    const ruta = rutaAvisos(conn);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));
    return true;
  } catch (e) {
    console.error("[avisos] no pude guardar:", e.message);
    return false;
  }
}

/** Ficha de un usuario: cuántos avisos lleva y por qué. */
export function verAvisos(conn, chatId, numero) {
  const n = DIGITS(numero);
  const ficha = leerTodo(conn)?.[chatId]?.[n];

  return {
    total: Number(ficha?.total) || 0,
    motivos: Array.isArray(ficha?.motivos) ? ficha.motivos : []
  };
}

/**
 * Suma un aviso.
 * @returns {{total:number, motivos:Array, limite:boolean}} limite = toca expulsar
 */
export function darAviso(conn, chatId, numero, motivo = "", porQuien = "") {
  const n = DIGITS(numero);
  const datos = leerTodo(conn);

  if (!datos[chatId]) datos[chatId] = {};
  if (!datos[chatId][n]) datos[chatId][n] = { total: 0, motivos: [] };

  const ficha = datos[chatId][n];
  ficha.total = (Number(ficha.total) || 0) + 1;

  if (!Array.isArray(ficha.motivos)) ficha.motivos = [];
  ficha.motivos.push({
    motivo: String(motivo || "Sin motivo").slice(0, 200),
    fecha: new Date().toISOString(),
    por: DIGITS(porQuien) || "sistema"
  });

  guardarTodo(conn, datos);

  return { total: ficha.total, motivos: ficha.motivos, limite: ficha.total >= AVISOS_MAX };
}

/**
 * Quita el último aviso.
 * @returns {{total:number, quitado:object|null, habia:boolean}}
 */
export function quitarAviso(conn, chatId, numero) {
  const n = DIGITS(numero);
  const datos = leerTodo(conn);
  const ficha = datos?.[chatId]?.[n];

  if (!ficha || !Number(ficha.total)) return { total: 0, quitado: null, habia: false };

  const quitado = Array.isArray(ficha.motivos) ? ficha.motivos.pop() || null : null;
  ficha.total = Math.max(0, (Number(ficha.total) || 0) - 1);

  // Sin avisos ya no hace falta guardar la ficha.
  if (ficha.total === 0) {
    delete datos[chatId][n];
    if (!Object.keys(datos[chatId]).length) delete datos[chatId];
  }

  guardarTodo(conn, datos);

  return { total: ficha.total, quitado, habia: true };
}

/** Borra todos los avisos de un usuario (se usa tras expulsarlo). */
export function limpiarAvisos(conn, chatId, numero) {
  const n = DIGITS(numero);
  const datos = leerTodo(conn);

  if (datos?.[chatId]?.[n]) {
    delete datos[chatId][n];
    if (!Object.keys(datos[chatId]).length) delete datos[chatId];
    guardarTodo(conn, datos);
  }
}

/** Todos los avisados de un grupo, de más a menos. */
export function listaDelGrupo(conn, chatId) {
  const grupo = leerTodo(conn)?.[chatId] || {};

  return Object.entries(grupo)
    .map(([numero, ficha]) => ({
      numero,
      total: Number(ficha?.total) || 0,
      motivos: Array.isArray(ficha?.motivos) ? ficha.motivos : []
    }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
}

export default { darAviso, quitarAviso, verAvisos, limpiarAvisos, listaDelGrupo, AVISOS_MAX };
