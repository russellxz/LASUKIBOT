// libs/cdn.js — Subir archivos al CDN de ORBITX SPACE y recibir el enlace.
// https://api.orbitxspace.com/cdn/tourl
//
// Lo usan .tourl, .tourl2, .tourl3, .hd, .whatmusic, .toanime2, .tovideo y la
// búsqueda de imágenes del RPG. Si el CDN se vuelve a mudar, se cambia aquí y
// listo (o con las variables de entorno CDN_URL / CDN_APIKEY).

"use strict";

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";

export const CDN_URL = (process.env.CDN_URL || "https://api.orbitxspace.com/cdn/tourl").replace(/\/+$/, "");
export const CDN_APIKEY = process.env.CDN_APIKEY || "Russellxz";

const TIMEOUT = 180000;

// El CDN puede devolver el enlace en distintos sitios según la versión.
export function urlDeRespuesta(data) {
  if (typeof data === "string") {
    const t = data.trim();
    return /^https?:\/\/\S+$/.test(t) ? t : null;
  }

  return (
    data?.result?.url ||
    data?.url ||
    data?.file?.url ||
    data?.data?.url ||
    data?.result?.data?.url ||
    data?.link ||
    data?.result?.link ||
    null
  );
}

function errorDe(data, status) {
  if (typeof data === "string") return data.slice(0, 200) || `HTTP ${status}`;
  return data?.message || data?.error || data?.result?.message || `HTTP ${status}`;
}

/**
 * Sube un archivo al CDN y devuelve su URL.
 * @param {Buffer|string} archivo  buffer o ruta en disco
 * @param {object} opciones
 * @param {string} opciones.filename     nombre con extensión (ayuda a que el enlace la conserve)
 * @param {string} opciones.contentType  mime, si se conoce
 * @param {string} opciones.name         nombre que se ve en la galería del CDN
 */
export async function subirCdn(archivo, { filename, contentType, name, timeout = TIMEOUT } = {}) {
  const esRuta = typeof archivo === "string";
  const nombre = filename || (esRuta ? path.basename(archivo) : `upload_${Date.now()}`);

  const form = new FormData();
  form.append(
    "file",
    esRuta ? fs.createReadStream(archivo) : archivo,
    contentType ? { filename: nombre, contentType } : { filename: nombre }
  );
  if (name) form.append("name", String(name).slice(0, 120));

  const r = await axios.post(CDN_URL, form, {
    headers: { ...form.getHeaders(), apikey: CDN_APIKEY },
    timeout,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });

  const url = urlDeRespuesta(r.data);
  if (r.status >= 400 || r.data?.status === false || r.data?.ok === false || !url) {
    throw new Error(`El CDN no devolvió enlace: ${errorDe(r.data, r.status)}`);
  }

  return url;
}

/** Pide al CDN que se baje un archivo de internet y lo guarde. */
export async function subirCdnDesdeUrl(remoteUrl, { name, timeout = TIMEOUT } = {}) {
  const r = await axios.post(
    CDN_URL,
    name ? { url: remoteUrl, name } : { url: remoteUrl },
    {
      headers: { apikey: CDN_APIKEY, "Content-Type": "application/json" },
      timeout,
      validateStatus: () => true
    }
  );

  const url = urlDeRespuesta(r.data);
  if (r.status >= 400 || r.data?.status === false || r.data?.ok === false || !url) {
    throw new Error(`El CDN no devolvió enlace: ${errorDe(r.data, r.status)}`);
  }

  return url;
}

export default { subirCdn, subirCdnDesdeUrl, urlDeRespuesta, CDN_URL, CDN_APIKEY };
