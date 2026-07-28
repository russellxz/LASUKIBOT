// libs/navegador.js — Peticiones que se comportan como un navegador de verdad.
//
// Lo usan .crack y .get2. Estaba duplicado y desincronizado entre los dos, que
// era justo la razón de que .crack dijera "funciona" y luego .get2 fallara:
// .crack pedía con la cookie de la página y .get2 pedía a pelo.
//
// No abre un Chrome de verdad (eso son 300MB y muchos hostings no lo aguantan),
// pero cubre lo que casi siempre hace falta: las cabeceras completas que manda
// Chrome, la cookie de sesión guardada entre peticiones, el Referer correcto y
// la espera cuando el sitio contesta "procesando".

"use strict";

import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import { promisify } from "util";
import { pipeline } from "stream";
const streamPipe = promisify(pipeline);

export const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const EXT_MEDIA = /\.(mp4|mkv|webm|m4v|mov|3gp|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|gif|pdf|zip|apk|rar|doc|docx)(\?|$)/i;
const EXT_VIDEO = /\.(mp4|mkv|webm|m4v|mov|3gp)(\?|$)/i;
const EXT_AUDIO = /\.(mp3|m4a|opus|ogg|wav|flac)(\?|$)/i;
const EXT_IMAGEN = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i;

// Un enlace de descarga rara vez apunta a estas cosas.
const NO_ES_DESCARGA = /(facebook\.com|twitter\.com|x\.com|instagram\.com|t\.me|whatsapp\.com|vk\.com\/share|pinterest\.|reddit\.com|linkedin\.|mailto:|javascript:|\/privacy|\/terms|\/contact|\/about|\/faq|\/blog|play\.google\.com|apps\.apple\.com|chrome\.google\.com)/i;

// ---------------------------------------------------------------- utilidades

export function normalizarUrl(entrada = "") {
  let u = String(entrada).trim();
  if (!u) return null;

  const inferido = !/^https?:\/\//i.test(u);
  if (inferido) u = "https://" + u;

  try {
    return { url: new URL(u), inferido };
  } catch {
    return null;
  }
}

// Sin esto el bot sería un puente hacia la red interna del servidor.
export function esHostPublico(u) {
  const host = String(u?.hostname || "").toLowerCase();

  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (host === "[::1]" || host === "::1") return false;

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }

  return true;
}

export function absoluto(ruta, base) {
  try {
    return new URL(ruta, base).toString();
  } catch {
    return "";
  }
}

export function recortar(texto, max = 300) {
  const t = String(texto ?? "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// ---------------------------------------------------------------- cabeceras

export function cabecerasNavegador({ tipo = "documento", referer = "", extra = {} } = {}) {
  const base = {
    "User-Agent": UA_CHROME,
    "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };

  if (tipo === "documento") {
    Object.assign(base, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": referer ? "same-origin" : "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1"
    });
  } else if (tipo === "xhr") {
    Object.assign(base, {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    });
  } else {
    Object.assign(base, {
      Accept: "*/*",
      "Sec-Fetch-Dest": "video",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site"
    });
  }

  if (referer) {
    base.Referer = referer;
    try {
      base.Origin = new URL(referer).origin;
    } catch {}
  }

  return { ...base, ...extra };
}

// ---------------------------------------------------------------- sesión

export class Sesion {
  constructor({ timeout = 60000, maxBytes = 8 * 1024 * 1024 } = {}) {
    this.cookies = new Map(); // host -> Map(nombre, valor)
    this.timeout = timeout;
    this.maxBytes = maxBytes;
    this.csrf = "";
    this.ultimaUrl = "";
  }

  guardarCookies(host, setCookie = []) {
    if (!setCookie.length) return;

    const tarro = this.cookies.get(host) || new Map();

    for (const linea of setCookie) {
      const par = String(linea).split(";")[0];
      const i = par.indexOf("=");
      if (i < 1) continue;
      tarro.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }

    this.cookies.set(host, tarro);
  }

  cookieDe(host) {
    const partes = [];

    for (const [h, tarro] of this.cookies) {
      // vale la del host exacto y la del dominio padre (api.sitio.com <- sitio.com)
      if (h === host || host.endsWith("." + h) || h.endsWith("." + host)) {
        for (const [k, v] of tarro) partes.push(`${k}=${v}`);
      }
    }

    return partes.join("; ");
  }

  async pedir(url, { metodo = "get", datos, tipo = "documento", referer, cabeceras = {}, timeout, responseType = "text" } = {}) {
    const destino = new URL(url);
    const cookie = this.cookieDe(destino.host);

    const res = await axios({
      method: metodo,
      url,
      data: datos,
      timeout: timeout || this.timeout,
      maxRedirects: 5,
      maxContentLength: this.maxBytes,
      responseType,
      transformResponse: responseType === "text" ? [(d) => d] : undefined,
      validateStatus: () => true,
      headers: {
        ...cabecerasNavegador({ tipo, referer: referer || this.ultimaUrl, extra: cabeceras }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(this.csrf ? { "X-CSRF-TOKEN": this.csrf } : {})
      }
    });

    this.guardarCookies(destino.host, res.headers?.["set-cookie"] || []);
    return res;
  }

  // Carga la portada como haría un navegador: guarda cookies y busca el token.
  async abrir(url) {
    const res = await this.pedir(url, { tipo: "documento" });
    const html = String(res.data || "");

    const token =
      html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)/i)?.[1] ||
      html.match(/name=["']_token["'][^>]+value=["']([^"']+)/i)?.[1] ||
      html.match(/name=["']csrf_token["'][^>]+value=["']([^"']+)/i)?.[1] ||
      "";

    if (token) this.csrf = token;
    this.ultimaUrl = url;

    return { res, html, token };
  }
}

// ---------------------------------------------------------------- enlaces

function puntuarEnlace(u) {
  let p = 0;
  if (EXT_MEDIA.test(u)) p += 10;
  if (/(videoplayback|googlevideo|cdn|storage|blob|media|stream)/i.test(u)) p += 4;
  if (/(download|descarg|dl\?|\/dl\/|attachment)/i.test(u)) p += 3;
  if (/(thumb|preview|poster|logo|icon|avatar|sprite)/i.test(u)) p -= 6;
  if (/\.(m3u8|mpd)(\?|$)/i.test(u)) p -= 4; // playlist, no archivo
  return p;
}

function enlacesDeJson(valor, salida = []) {
  if (!valor) return salida;

  if (typeof valor === "string") {
    if (/^https?:\/\//i.test(valor) && !NO_ES_DESCARGA.test(valor)) {
      if (EXT_MEDIA.test(valor) || /(download|descarg|cdn|media|videoplayback|stream|blob|storage)/i.test(valor)) {
        salida.push(valor);
      }
    }
    return salida;
  }

  if (Array.isArray(valor)) {
    for (const v of valor) enlacesDeJson(v, salida);
    return salida;
  }

  if (typeof valor === "object") {
    for (const k of Object.keys(valor)) enlacesDeJson(valor[k], salida);
  }

  return salida;
}

function enlacesDeHtml(html, base) {
  const salida = [];

  try {
    const $ = cheerio.load(html);

    $("a[href], source[src], video[src], audio[src], video source, [data-url], [download]").each((_, el) => {
      const $e = $(el);
      const v = $e.attr("href") || $e.attr("src") || $e.attr("data-url") || "";
      if (!v) return;

      const u = absoluto(v, base);
      if (!u || NO_ES_DESCARGA.test(u)) return;

      const tieneDownload = $e.attr("download") !== undefined;
      if (tieneDownload || EXT_MEDIA.test(u) || /(download|descarg|cdn|dl\?|\/dl\/|videoplayback)/i.test(u)) {
        salida.push(u);
      }
    });
  } catch {}

  // Enlaces sueltos dentro del texto o de un JSON incrustado
  const re = /https?:\/\/[^\s"'<>\\)]+/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[0].replace(/\\\//g, "/");
    if (!NO_ES_DESCARGA.test(u) && EXT_MEDIA.test(u)) salida.push(u);
  }

  return salida;
}

export function extraerEnlaces(cuerpo, base) {
  let json = null;

  try {
    json = JSON.parse(cuerpo);
  } catch {}

  const crudos = json ? enlacesDeJson(json) : enlacesDeHtml(String(cuerpo || ""), base);

  const unicos = [...new Set(crudos.map((u) => u.replace(/&amp;/g, "&")))];
  return { json, enlaces: unicos.sort((a, b) => puntuarEnlace(b) - puntuarEnlace(a)) };
}

// ¿El sitio está diciendo "dame un momento"?
export function pareceEnProgreso(cuerpo, json) {
  if (json) {
    const s = JSON.stringify(json).toLowerCase();
    if (/"(status|state)"\s*:\s*"?(pending|processing|progress|running|waiting|queue|in_progress|started)/.test(s)) return true;
    if (/"progress"\s*:\s*("?\d)/.test(s) && !/"progress"\s*:\s*"?(100|1000)\b/.test(s)) return true;
    if (/"(jobid|job_id|taskid|task_id|conversion_id)"\s*:/.test(s)) return true;
    return false;
  }

  return /(procesando|processing|please wait|por favor espera|converting|convirtiendo|in queue|preparing)/i.test(String(cuerpo || ""));
}

// Si la respuesta trae la URL donde consultar el progreso, la usamos.
export function urlDeProgreso(cuerpo, base) {
  const re = /https?:\/\/[^\s"'<>\\)]*(?:progress|status|check|poll|result)[^\s"'<>\\)]*/i;
  const enTexto = String(cuerpo || "").match(re);
  if (enTexto) return enTexto[0].replace(/\\\//g, "/").replace(/&amp;/g, "&");

  const relativo = String(cuerpo || "").match(/["'](\/[^\s"'<>]*(?:progress|status|check|poll)[^\s"'<>]*)["']/i);
  return relativo ? absoluto(relativo[1], base) : "";
}

// ---------------------------------------------------------------- archivos

// Baja solo el principio para saber si es un archivo de verdad, sin gastar
// datos en algo que luego resulta ser una página de error.
export async function verificarEnlace(url, sesion, referer) {
  try {
    const res = await sesion.pedir(url, {
      tipo: "media",
      referer,
      responseType: "stream",
      timeout: 25000,
      cabeceras: { Range: "bytes=0-4095" }
    });

    if (res.status >= 400) return { ok: false, motivo: `HTTP ${res.status}` };

    const tipo = String(res.headers?.["content-type"] || "").split(";")[0];

    if (/text\/html|application\/(json|xml)|text\/plain/i.test(tipo)) {
      try { res.data.destroy(); } catch {}
      return { ok: false, motivo: `devuelve ${tipo || "texto"}, no un archivo` };
    }

    const trozo = await new Promise((resolve) => {
      const partes = [];
      let total = 0;

      res.data.on("data", (c) => {
        partes.push(c);
        total += c.length;
        if (total >= 4096) {
          try { res.data.destroy(); } catch {}
        }
      });
      res.data.on("end", () => resolve(Buffer.concat(partes)));
      res.data.on("close", () => resolve(Buffer.concat(partes)));
      res.data.on("error", () => resolve(Buffer.concat(partes)));
    });

    if (!trozo.length) return { ok: false, motivo: "no devolvió datos" };

    // Un HTML sin content-type correcto sigue siendo un HTML.
    const inicio = trozo.slice(0, 200).toString("latin1").trim().toLowerCase();
    if (inicio.startsWith("<!doctype html") || inicio.startsWith("<html") || inicio.startsWith("<?xml")) {
      return { ok: false, motivo: "el contenido es una página web" };
    }

    const rango = String(res.headers?.["content-range"] || "");
    const total = Number(rango.split("/")[1] || res.headers?.["content-length"] || 0);

    return { ok: true, tipo, tamaño: total, cabecera: trozo.slice(0, 16) };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

export async function descargarArchivo(url, destino, sesion, referer) {
  const res = await sesion.pedir(url, {
    tipo: "media",
    referer,
    responseType: "stream",
    timeout: 300000
  });

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);

  const tipo = String(res.headers?.["content-type"] || "").split(";")[0];
  if (/text\/html|application\/json/i.test(tipo)) {
    try { res.data.destroy(); } catch {}
    throw new Error(`devolvió ${tipo}, no un archivo`);
  }

  const esperado = Number(res.headers?.["content-length"] || 0);
  await streamPipe(res.data, fs.createWriteStream(destino));

  const real = fs.statSync(destino).size;
  if (!real) throw new Error("el archivo llegó vacío");
  if (esperado && real !== esperado) throw new Error(`descarga incompleta (${real} de ${esperado} bytes)`);

  return { tamaño: real, tipo };
}

// Por la cabecera del archivo, no por la extensión: muchos enlaces no la tienen.
export function tipoDeArchivo(destino, url = "", contentType = "") {
  try {
    const fd = fs.openSync(destino, "r");
    const b = Buffer.alloc(12);
    try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }

    const marca = b.slice(4, 8).toString("latin1");
    if (marca === "ftyp") {
      const sub = b.slice(8, 12).toString("latin1").toLowerCase();
      return sub.startsWith("m4a") ? "audio" : "video";
    }
    if (b.slice(0, 3).toString("latin1") === "ID3") return "audio";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio";
    if (b[0] === 0xff && b[1] === 0xd8) return "imagen";
    if (b.slice(1, 4).toString("latin1") === "PNG") return "imagen";
    if (b.slice(0, 4).toString("latin1") === "RIFF") return "audio";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video";
    if (b.slice(0, 4).toString("latin1") === "OggS") return "audio";
    if (b.slice(0, 4).toString("latin1") === "%PDF") return "documento";
  } catch {}

  if (EXT_VIDEO.test(url) || /video\//i.test(contentType)) return "video";
  if (EXT_AUDIO.test(url) || /audio\//i.test(contentType)) return "audio";
  if (EXT_IMAGEN.test(url) || /image\//i.test(contentType)) return "imagen";

  return "documento";
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
