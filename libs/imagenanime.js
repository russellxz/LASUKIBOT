// libs/imagenanime.js — Buscar la foto de un personaje y dejarla en el CDN.
//
// Es lo que hacían .pinterestimg y .tourl, pero encadenado y sin pasar por
// WhatsApp: se busca en Pinterest, se baja la imagen, se comprueba que sea una
// imagen de verdad y se sube al CDN. Devuelve la URL ya lista para el RPG.
//
// Si la primera imagen no sirve prueba con la siguiente, porque Pinterest
// devuelve enlaces rotos de vez en cuando.

"use strict";

import axios from "axios";
import FormData from "form-data";

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const CDN = process.env.CDN_UPLOAD || "https://cdn.russellxz.click/upload.php";

const NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CUANTAS_PROBAR = 5;      // cuántos resultados intentar antes de rendirse
const MIN_BYTES = 3 * 1024;    // menos de esto no es una foto, es un icono roto
const MAX_BYTES = 12 * 1024 * 1024;

/** ¿Esto es de verdad una imagen? Se mira el principio del archivo. */
export function esImagen(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buf.subarray(0, 6).toString() === "GIF89a" || buf.subarray(0, 6).toString() === "GIF87a") return "gif";

  return null;
}

/** De cada resultado de Pinterest, el enlace de imagen más grande que traiga. */
export function mejorEnlace(it) {
  return (
    it?.image_large_url ||
    it?.image_medium_url ||
    it?.image_small_url ||
    it?.url ||
    it?.image ||
    ""
  );
}

/** Busca en Pinterest y devuelve la lista de enlaces de imagen. */
export async function buscarEnPinterest(consulta, limite = 10) {
  const r = await axios.post(
    `${API_BASE}/pinterestimg`,
    { q: consulta, limit: limite },
    {
      headers: { "Content-Type": "application/json", apikey: API_KEY, Accept: "application/json, */*" },
      timeout: 60000,
      validateStatus: () => true
    }
  );

  let datos = r.data;
  if (typeof datos === "string") {
    try { datos = JSON.parse(datos.trim()); }
    catch { throw new Error(`la API no devolvió JSON (HTTP ${r.status})`); }
  }

  if (!datos || typeof datos !== "object") throw new Error(`respuesta rara de la API (HTTP ${r.status})`);

  const bien = datos.status === true || datos.status === "true" || datos.ok === true || datos.success === true;
  if (!bien) throw new Error(datos.message || datos.error || `error de la API (HTTP ${r.status})`);

  const dentro = datos.result || datos.data || datos;
  const bruto = Array.isArray(dentro?.results) ? dentro.results : Array.isArray(dentro) ? dentro : [];

  return bruto.map(mejorEnlace).filter(Boolean);
}

/** Baja la imagen y comprueba que lo sea. */
export async function bajarImagen(url) {
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: { "User-Agent": NAVEGADOR, Accept: "image/*,*/*" },
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);

  const buf = Buffer.from(r.data);
  if (buf.length < MIN_BYTES) throw new Error(`pesa ${buf.length} bytes, no es una foto`);
  if (buf.length > MAX_BYTES) throw new Error(`pesa demasiado (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

  const tipo = esImagen(buf);
  if (!tipo) throw new Error("lo que bajó no es una imagen");

  return { buffer: buf, tipo };
}

/** Sube el buffer al CDN y devuelve la URL. */
export async function subirAlCdn(buffer, nombre = "imagen.jpg") {
  const form = new FormData();
  form.append("file", buffer, { filename: nombre });

  const r = await axios.post(CDN, form, {
    headers: form.getHeaders(),
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const url =
    r.data?.url || r.data?.file?.url || r.data?.data?.url || r.data?.result?.url ||
    (typeof r.data === "string" && /^https?:\/\/\S+$/.test(r.data.trim()) ? r.data.trim() : null);

  if (!url) {
    const visto = typeof r.data === "string" ? r.data.slice(0, 150) : JSON.stringify(r.data || {}).slice(0, 150);
    throw new Error(`el CDN no devolvió URL. Contestó: ${visto}`);
  }

  return url;
}

/**
 * Todo de una: busca al personaje, baja la primera imagen que sirva y la sube.
 *
 * @returns {Promise<{url:string, origen:string, intentos:number}>}
 */
export async function fotoDePersonaje(nombre, anime, opciones = {}) {
  const { cuantasProbar = CUANTAS_PROBAR } = opciones;

  const limpio = String(nombre).replace(/_/g, " ");
  const consulta = `${limpio} ${anime} anime`;

  const enlaces = await buscarEnPinterest(consulta);
  if (!enlaces.length) throw new Error(`Pinterest no devolvió nada para "${consulta}"`);

  const fallos = [];

  for (let i = 0; i < Math.min(enlaces.length, cuantasProbar); i++) {
    try {
      const { buffer, tipo } = await bajarImagen(enlaces[i]);
      const archivo = `${String(nombre).toLowerCase().replace(/[^a-z0-9]/g, "_")}.${tipo}`;
      const url = await subirAlCdn(buffer, archivo);

      return { url, origen: enlaces[i], intentos: i + 1 };
    } catch (e) {
      fallos.push(e.message);
    }
  }

  throw new Error(`ninguna imagen sirvió (${fallos.slice(0, 3).join(" · ")})`);
}

export default { fotoDePersonaje, buscarEnPinterest, bajarImagen, subirAlCdn, esImagen, mejorEnlace };
