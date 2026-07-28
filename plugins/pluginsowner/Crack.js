import { canal } from "../../disenos.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";

// comandos/crack.js — Analiza una web de descargas y te dice cómo pedirle
// el archivo directamente, sin pasar por la página.
//
// .crack <url del sitio>              → busca el endpoint de descarga
// .crack <url del sitio> <enlace>     → además lo prueba de verdad y, si
//                                       responde, te manda el plugin listo
//
// Solo owner: es una herramienta de desarrollo y hace peticiones salientes
// desde el servidor del bot.

"use strict";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMEOUT = 45000;
const TIMEOUT_PRUEBA = 20000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SCRIPTS = 6;
const MAX_CANDIDATOS = 12;
const MAX_PRUEBAS = 5;
const MAX_INTENTOS = 20;
const LIMITE_PRUEBAS_MS = 100000;

const EXT_MEDIA = /\.(mp4|mkv|webm|m4v|mov|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|gif|pdf|zip|apk|rar)(\?|$)/i;

// ---------- utils ----------
function esOwner(msg) {
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  if (msg.key.fromMe) return true;

  try {
    const ownerPath = path.resolve("owner.json");
    const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
    return owners.some(([id]) => id === senderId);
  } catch {
    return false;
  }
}

function normalizarUrl(entrada = "") {
  let u = String(entrada).trim();
  if (!u) return null;

  // Si el esquema lo ponemos nosotros, luego probamos http por si el sitio
  // no tiene https.
  const inferido = !/^https?:\/\//i.test(u);
  if (inferido) u = "https://" + u;

  try {
    return { url: new URL(u), inferido };
  } catch {
    return null;
  }
}

// Sin esto, un .crack http://10.0.0.1/... convertiría al bot en un puente
// hacia la red interna del servidor.
function esHostPublico(u) {
  const host = String(u.hostname || "").toLowerCase();

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

function absoluto(ruta, base) {
  try {
    return new URL(ruta, base).toString();
  } catch {
    return "";
  }
}

function recortar(texto, max = 300) {
  const t = String(texto ?? "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function pedir(url, { metodo = "get", datos, cabeceras = {}, referer, timeout = TIMEOUT } = {}) {
  const res = await axios({
    method: metodo,
    url,
    data: datos,
    timeout,
    maxRedirects: 5,
    maxContentLength: MAX_BYTES,
    responseType: "text",
    transformResponse: [(d) => d],
    validateStatus: () => true,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Accept: "*/*",
      ...(referer ? { Referer: referer, Origin: new URL(referer).origin } : {}),
      ...cabeceras
    }
  });

  return res;
}

// ---------- análisis del HTML ----------
function analizarFormularios($, base) {
  const formularios = [];

  $("form").each((_, el) => {
    const $f = $(el);
    const action = absoluto($f.attr("action") || "", base) || base;
    const metodo = String($f.attr("method") || "get").toLowerCase();
    const campos = [];

    $f.find("input, select, textarea").each((__, inp) => {
      const $i = $(inp);
      const name = $i.attr("name");
      if (!name) return;

      campos.push({
        name,
        tipo: String($i.attr("type") || inp.tagName || "text").toLowerCase(),
        valor: $i.attr("value") || "",
        placeholder: $i.attr("placeholder") || ""
      });
    });

    if (campos.length) formularios.push({ action, metodo, campos });
  });

  return formularios;
}

const PATRONES = [
  { re: /fetch\s*\(\s*[`'"]([^`'"]{2,200})[`'"]/g, grupo: 1, via: "fetch" },
  { re: /axios\s*\.\s*(get|post)\s*\(\s*[`'"]([^`'"]{2,200})[`'"]/gi, grupo: 2, via: "axios" },
  { re: /\$\.\s*(?:ajax|post|get)\s*\(\s*\{?\s*(?:url\s*:\s*)?[`'"]([^`'"]{2,200})[`'"]/gi, grupo: 1, via: "jquery" },
  { re: /\.open\s*\(\s*[`'"](?:GET|POST)[`'"]\s*,\s*[`'"]([^`'"]{2,200})[`'"]/gi, grupo: 1, via: "xhr" },
  {
    re: /[`'"]((?:https?:\/\/[^`'"\s]+|\/)(?:api|ajax|dl|download|descargar|convert|process|server|action|search)[^`'"\s]{0,150})[`'"]/gi,
    grupo: 1,
    via: "ruta"
  }
];

const RUIDO = /(google|gtag|facebook|analytics|doubleclick|adservice|jquery|bootstrap|fontawesome|cloudflare\/|\.css|\.png|\.jpg|\.svg|\.woff|sentry|hotjar|onesignal|histats)/i;
const SEÑAL = /(download|descarg|convert|dl|api|ajax|process|server|action|media|video|audio|mp3|mp4|search)/i;

// Cuando el JavaScript hace $.post("./", { url: q, sid: sid, lngg: ln }), esos
// nombres son exactamente los campos que hay que mandar. Vale más que la URL.
const LLAMADAS_CON_CAMPOS = [
  /\$\.\s*(?:post|get)\s*\(\s*[`'"]([^`'"]{1,200})[`'"]\s*,\s*\{([^{}]{0,500})\}/g,
  /axios\s*\.\s*post\s*\(\s*[`'"]([^`'"]{1,200})[`'"]\s*,\s*\{([^{}]{0,500})\}/g,
  /\$\.\s*ajax\s*\(\s*\{\s*url\s*:\s*[`'"]([^`'"]{1,200})[`'"][^{}]{0,200}data\s*:\s*\{([^{}]{0,500})\}/g
];

// Los valores suelen ser variables (sid: sid). Si la variable está declarada en
// la página con un valor fijo, lo aprovechamos.
function variablesGlobales(fuentes) {
  const vars = {};
  const re = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"\n]{1,200})['"]/g;

  for (const { texto } of fuentes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto)) !== null) vars[m[1]] = m[2];
  }

  return vars;
}

function camposDeObjeto(texto = "", globales = {}) {
  const campos = [];
  const re = /(?:^|[,{\s])(?:([A-Za-z_$][\w$]*)|['"]([^'"]+)['"])\s*:\s*([^,}]+)/g;
  let m;

  while ((m = re.exec(texto)) !== null) {
    const name = m[1] || m[2];
    if (!name) continue;

    const crudo = String(m[3] || "").trim();
    const literal = crudo.match(/^['"]([^'"]*)['"]$/);
    const identificador = crudo.match(/^[A-Za-z_$][\w$]*$/);

    let valor = "";
    if (literal) valor = literal[1];
    else if (identificador && globales[crudo] !== undefined) valor = globales[crudo];

    campos.push({ name, tipo: "text", valor });
  }

  return campos;
}

function analizarLlamadas(fuentes, base, globales) {
  const encontrados = new Map();

  for (const { texto, origen } of fuentes) {
    for (const re of LLAMADAS_CON_CAMPOS) {
      re.lastIndex = 0;
      let m;

      while ((m = re.exec(texto)) !== null) {
        const ruta = m[1];
        const campos = camposDeObjeto(m[2], globales);
        if (!campos.length) continue;

        const url = /^https?:\/\//i.test(ruta) ? ruta : absoluto(ruta, base);
        if (!url || RUIDO.test(url)) continue;

        const clave = url + "|" + campos.map((c) => c.name).join(",");

        if (!encontrados.has(clave)) {
          encontrados.set(clave, { url, via: "ajax con campos", origen, campos, puntos: 20 });
        }
      }
    }
  }

  return [...encontrados.values()];
}

function analizarScripts(fuentes, base) {
  const vistos = new Map();

  for (const { texto, origen } of fuentes) {
    for (const { re, grupo, via } of PATRONES) {
      re.lastIndex = 0;
      let m;

      while ((m = re.exec(texto)) !== null) {
        const crudo = m[grupo];
        if (!crudo || crudo.length < 2) continue;
        if (crudo.includes("${") || crudo.includes("+")) continue;
        if (RUIDO.test(crudo)) continue;

        const url = /^https?:\/\//i.test(crudo) ? crudo : absoluto(crudo, base);
        if (!url) continue;
        if (EXT_MEDIA.test(url)) continue;

        if (!vistos.has(url)) vistos.set(url, { url, via, origen, puntos: 0 });
      }
    }
  }

  for (const c of vistos.values()) {
    if (SEÑAL.test(c.url)) c.puntos += 3;
    if (/\/(api|ajax)\//i.test(c.url)) c.puntos += 2;
    if (/(download|descarg|convert)/i.test(c.url)) c.puntos += 4;
    if (c.via !== "ruta") c.puntos += 2;

    try {
      if (new URL(c.url).host === new URL(base).host) c.puntos += 2;
    } catch {}
  }

  return [...vistos.values()].sort((a, b) => b.puntos - a.puntos).slice(0, MAX_CANDIDATOS);
}

function detectarProtecciones(texto, cabeceras) {
  const avisos = [];
  let bloqueante = "";
  const servidor = String(cabeceras?.server || "").toLowerCase();

  // Un token que se genera dentro del navegador en cada envío no se puede
  // reproducir desde el bot: conviene saberlo antes de perder el tiempo.
  if (/grecaptcha\s*\.\s*execute/i.test(texto)) {
    bloqueante = "reCAPTCHA v3 — el sitio genera un token nuevo en el navegador con cada envío y lo manda junto al formulario. Ese token no se puede fabricar desde el bot.";
    avisos.push(bloqueante);
  } else if (/recaptcha/i.test(texto)) {
    avisos.push("reCAPTCHA presente en la página");
  }

  if (/hcaptcha\.com|h-captcha/i.test(texto)) {
    bloqueante = bloqueante || "hCaptcha — hay que resolverlo en un navegador.";
    avisos.push("hCaptcha");
  }
  if (/turnstile/i.test(texto)) {
    bloqueante = bloqueante || "Cloudflare Turnstile — hay que resolverlo en un navegador.";
    avisos.push("Cloudflare Turnstile");
  }
  if (servidor.includes("cloudflare") || /cf-browser-verification|challenge-platform/i.test(texto)) {
    avisos.push("Cloudflare — puede pedir verificación de navegador");
  }
  if (/csrf|_token|authenticity_token/i.test(texto)) {
    avisos.push("Token CSRF — se lee de la página antes de pedir (esto sí lo hace el bot)");
  }
  if (/admin-ajax\.php/i.test(texto)) {
    avisos.push("WordPress admin-ajax — suele pedir un nonce");
  }

  return { avisos: [...new Set(avisos)], bloqueante };
}

// ---------- buscar el archivo en la respuesta ----------
function enlacesDesdeJson(valor, encontrados = []) {
  if (!valor) return encontrados;

  if (typeof valor === "string") {
    if (/^https?:\/\//i.test(valor) && (EXT_MEDIA.test(valor) || /(download|cdn|media|videoplayback)/i.test(valor))) {
      encontrados.push(valor);
    }
    return encontrados;
  }

  if (Array.isArray(valor)) {
    for (const v of valor) enlacesDesdeJson(v, encontrados);
    return encontrados;
  }

  if (typeof valor === "object") {
    for (const k of Object.keys(valor)) enlacesDesdeJson(valor[k], encontrados);
  }

  return encontrados;
}

function enlacesDesdeHtml(html, base) {
  const encontrados = [];

  try {
    const $ = cheerio.load(html);

    $("a[href], source[src], video[src], audio[src]").each((_, el) => {
      const v = $(el).attr("href") || $(el).attr("src") || "";
      const u = absoluto(v, base);
      if (u && (EXT_MEDIA.test(u) || /(download|descarg|cdn)/i.test(u))) encontrados.push(u);
    });
  } catch {}

  return encontrados;
}

function buscarArchivo(cuerpo, base) {
  let json = null;

  try {
    json = JSON.parse(cuerpo);
  } catch {}

  const enlaces = json ? enlacesDesdeJson(json) : enlacesDesdeHtml(cuerpo, base);
  return { json, enlaces: [...new Set(enlaces)] };
}

// ---------- probar un candidato de verdad ----------
function campoDeUrl(campos = []) {
  const porTipo = campos.find((c) => c.tipo === "url");
  if (porTipo) return porTipo.name;

  const porNombre = campos.find((c) => /url|link|enlace|video|q|query|search/i.test(c.name));
  if (porNombre) return porNombre.name;

  const texto = campos.find((c) => c.tipo === "text" || c.tipo === "search");
  return texto ? texto.name : "url";
}

// Un endpoint sacado del JavaScript no dice cómo se llaman sus campos, pero el
// formulario de la misma página normalmente sí: probamos esa combinación antes
// que los nombres genéricos.
function juegosDeCampos(candidato, formularios) {
  const juegos = [];

  if (candidato.campos?.length) juegos.push(candidato.campos);

  for (const f of formularios) {
    if (f.campos?.length) juegos.push(f.campos);
  }

  for (const nombre of ["url", "link", "q", "id"]) {
    juegos.push([{ name: nombre, tipo: "text", valor: "" }]);
  }

  return juegos.slice(0, 4);
}

function intentosPara(candidato, urlPrueba, formularios) {
  const intentos = [];
  const vistos = new Set();

  for (const campos of juegosDeCampos(candidato, formularios)) {
    const nombre = campoDeUrl(campos);
    const fijos = {};

    for (const c of campos) {
      if (c.name !== nombre && c.valor) fijos[c.name] = c.valor;
    }

    const cuerpo = { ...fijos, [nombre]: urlPrueba };
    const firma = JSON.stringify(cuerpo);
    if (vistos.has(firma)) continue;
    vistos.add(firma);

    const query = new URLSearchParams(cuerpo).toString();

    intentos.push(
      { etiqueta: "POST form", metodo: "post", datos: query, cabeceras: { "Content-Type": "application/x-www-form-urlencoded" }, cuerpo, nombre },
      { etiqueta: "POST json", metodo: "post", datos: JSON.stringify(cuerpo), cabeceras: { "Content-Type": "application/json" }, cuerpo, nombre },
      { etiqueta: "GET query", metodo: "get", sufijo: "?" + query, cuerpo, nombre }
    );
  }

  return intentos;
}

async function probarCandidato(candidato, urlPrueba, base, ctx) {
  for (const intento of intentosPara(candidato, urlPrueba, ctx.formularios)) {
    if (ctx.usados >= MAX_INTENTOS || Date.now() > ctx.limite) break;
    ctx.usados++;

    try {
      const url = candidato.url + (intento.sufijo || "");
      const res = await pedir(url, {
        metodo: intento.metodo,
        datos: intento.datos,
        timeout: TIMEOUT_PRUEBA,
        referer: base,
        cabeceras: {
          ...intento.cabeceras,
          "X-Requested-With": "XMLHttpRequest",
          ...(ctx.cookies ? { Cookie: ctx.cookies } : {}),
          ...(ctx.csrf ? { "X-CSRF-TOKEN": ctx.csrf } : {})
        }
      });

      if (res.status >= 400) continue;

      const cuerpo = String(res.data || "");
      const { json, enlaces } = buscarArchivo(cuerpo, base);
      if (!enlaces.length) continue;

      return {
        ok: true,
        intento,
        status: res.status,
        tipo: String(res.headers?.["content-type"] || "").split(";")[0],
        esJson: !!json,
        enlaces,
        muestra: recortar(cuerpo, 400)
      };
    } catch {}
  }

  return { ok: false };
}

// ---------- generar el plugin ----------
function generarPlugin({ nombre, sitio, endpoint, intento, esJson, necesitaSesion }) {
  const comando = nombre.toLowerCase().replace(/[^a-z0-9]/g, "") || "descarga";

  // Solo los campos fijos: el del enlace lo pone el usuario al usar el comando.
  const fijos = { ...intento.cuerpo };
  delete fijos[intento.nombre];

  const cuerpoJs = JSON.stringify(fijos, null, 2);
  const contentType = intento.cabeceras?.["Content-Type"] || "application/x-www-form-urlencoded";
  const cuerpoEsJson = contentType === "application/json";

  const extraer = esJson
    ? [
        "function extraerEnlaces(cuerpo) {",
        "  const encontrados = [];",
        "",
        "  const recorrer = (valor) => {",
        "    if (!valor) return;",
        "",
        "    if (typeof valor === 'string') {",
        "      if (/^https?:\\/\\//i.test(valor) && (EXT_MEDIA.test(valor) || /(download|cdn|media)/i.test(valor))) {",
        "        encontrados.push(valor);",
        "      }",
        "      return;",
        "    }",
        "",
        "    if (Array.isArray(valor)) return valor.forEach(recorrer);",
        "    if (typeof valor === 'object') Object.keys(valor).forEach((k) => recorrer(valor[k]));",
        "  };",
        "",
        "  try { recorrer(JSON.parse(cuerpo)); } catch {}",
        "",
        "  return [...new Set(encontrados)];",
        "}"
      ]
    : [
        "function extraerEnlaces(cuerpo) {",
        "  const encontrados = [];",
        "",
        "  try {",
        "    const $ = cheerio.load(cuerpo);",
        "",
        "    $('a[href], source[src], video[src], audio[src]').each((_, el) => {",
        "      const v = $(el).attr('href') || $(el).attr('src') || '';",
        "      const u = v ? new URL(v, SITIO).toString() : '';",
        "      if (u && (EXT_MEDIA.test(u) || /(download|descarg|cdn)/i.test(u))) encontrados.push(u);",
        "    });",
        "  } catch {}",
        "",
        "  return [...new Set(encontrados)];",
        "}"
      ];

  const lineas = [
    "import { canal } from '../../disenos.js';",
    "import fs from 'fs';",
    "import path from 'path';",
    "import axios from 'axios';",
    ...(esJson ? [] : ["import * as cheerio from 'cheerio';"]),
    "import { promisify } from 'util';",
    "import { pipeline } from 'stream';",
    "const streamPipe = promisify(pipeline);",
    "",
    "// Generado por .crack a partir de " + sitio,
    "// Revisa el endpoint y los campos antes de dejarlo en producción: si el",
    "// sitio cambia su web, esto deja de funcionar y hay que volver a pasarle .crack.",
    "",
    "'use strict';",
    "",
    "const SITIO = " + JSON.stringify(sitio) + ";",
    "const ENDPOINT = " + JSON.stringify(endpoint) + ";",
    "const METODO = " + JSON.stringify(intento.metodo) + ";",
    "const CAMPO_URL = " + JSON.stringify(intento.nombre) + ";",
    "const MAX_MB = 200;",
    "",
    "const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';",
    "const EXT_MEDIA = /\\.(mp4|mkv|webm|m4v|mov|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|pdf|zip|apk)(\\?|$)/i;",
    "",
    "// Campos tal cual los mandaba la página. El del enlace se rellena al vuelo.",
    "const CAMPOS = " + cuerpoJs + ";",
    "",
    "function safeName(nombre = 'archivo') {",
    "  return String(nombre).slice(0, 90).replace(/[^\\w.\\-]+/g, '_') || 'archivo';",
    "}",
    "",
    "function ensureTmp() {",
    "  const tmp = path.resolve('./tmp');",
    "  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });",
    "  return tmp;",
    "}",
    "",
    ...extraer,
    "",
    ...(necesitaSesion
      ? [
          "// El sitio solo responde si llevas su cookie de sesión y su token, y",
          "// ambos caducan: se piden de nuevo en cada descarga.",
          "async function abrirSesion() {",
          "  const res = await axios.get(SITIO, {",
          "    timeout: 45000,",
          "    responseType: 'text',",
          "    transformResponse: [(d) => d],",
          "    validateStatus: () => true,",
          "    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }",
          "  });",
          "",
          "  const html = String(res.data || '');",
          "",
          "  const cookies = (res.headers?.['set-cookie'] || [])",
          "    .map((c) => String(c).split(';')[0])",
          "    .join('; ');",
          "",
          "  const token =",
          "    html.match(/<meta[^>]+name=[\"']csrf-token[\"'][^>]+content=[\"']([^\"']+)/i)?.[1] ||",
          "    html.match(/name=[\"']_token[\"'][^>]+value=[\"']([^\"']+)/i)?.[1] ||",
          "    '';",
          "",
          "  return { cookies, token };",
          "}",
          "",
        ]
      : []),
    "async function pedirArchivo(enlace) {",
    "  const cuerpo = { ...CAMPOS, [CAMPO_URL]: enlace };",
    ...(necesitaSesion ? ["  const sesion = await abrirSesion();"] : []),
    "  const datos = " + (cuerpoEsJson ? "JSON.stringify(cuerpo);" : "new URLSearchParams(cuerpo).toString();"),
    "",
    "  const res = await axios({",
    "    method: METODO,",
    "    url: METODO === 'get' ? ENDPOINT + '?' + new URLSearchParams(cuerpo).toString() : ENDPOINT,",
    "    data: METODO === 'get' ? undefined : datos,",
    "    timeout: 90000,",
    "    maxRedirects: 5,",
    "    responseType: 'text',",
    "    transformResponse: [(d) => d],",
    "    validateStatus: () => true,",
    "    headers: {",
    "      'User-Agent': UA,",
    "      'Content-Type': " + JSON.stringify(contentType) + ",",
    "      'X-Requested-With': 'XMLHttpRequest',",
    "      Referer: SITIO,",
    "      Origin: new URL(SITIO).origin,",
    "      Accept: '*/*',",
    ...(necesitaSesion
      ? [
          "      ...(sesion.cookies ? { Cookie: sesion.cookies } : {}),",
          "      ...(sesion.token ? { 'X-CSRF-TOKEN': sesion.token } : {})"
        ]
      : ["      'Accept-Language': 'es-ES,es;q=0.9'"]),
    "    }",
    "  });",
    "",
    "  if (res.status >= 400) throw new Error('El sitio respondió HTTP ' + res.status);",
    "",
    "  const enlaces = extraerEnlaces(String(res.data || ''));",
    "  if (!enlaces.length) throw new Error('El sitio no devolvió ningún enlace de descarga');",
    "",
    "  return enlaces;",
    "}",
    "",
    "async function descargar(url, destino) {",
    "  const res = await axios.get(url, {",
    "    responseType: 'stream',",
    "    timeout: 300000,",
    "    maxRedirects: 5,",
    "    validateStatus: () => true,",
    "    headers: { 'User-Agent': UA, Referer: SITIO, Accept: '*/*' }",
    "  });",
    "",
    "  if (res.status >= 400) throw new Error('HTTP_' + res.status);",
    "",
    "  const tipo = String(res.headers?.['content-type'] || '');",
    "  if (/text\\/html|application\\/json/i.test(tipo)) {",
    "    try { res.data.destroy(); } catch {}",
    "    throw new Error('El enlace devolvió una página, no un archivo');",
    "  }",
    "",
    "  const esperado = Number(res.headers?.['content-length'] || 0);",
    "  await streamPipe(res.data, fs.createWriteStream(destino));",
    "",
    "  const real = fs.statSync(destino).size;",
    "  if (!real) throw new Error('El archivo llegó vacío');",
    "  if (esperado && real !== esperado) throw new Error('Descarga incompleta (' + real + ' de ' + esperado + ')');",
    "",
    "  return destino;",
    "}",
    "",
    "const handler = async (msg, { conn, args, command }) => {",
    "  const chatId = msg.key.remoteJid;",
    "  const pref = global.prefixes?.[0] || '.';",
    "  const enlace = (args[0] || '').trim();",
    "",
    "  if (!enlace) {",
    "    return conn.sendMessage(chatId, {",
    "      contextInfo: canal(),",
    "      text: `✳️ Usa:\\n${pref}${command} <enlace>\\n\\nDescarga desde ${SITIO}`",
    "    }, { quoted: msg });",
    "  }",
    "",
    "  await conn.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });",
    "",
    "  let enlaces;",
    "",
    "  try {",
    "    enlaces = await pedirArchivo(enlace);",
    "  } catch (e) {",
    "    return conn.sendMessage(chatId, {",
    "      contextInfo: canal(),",
    "      text: `❌ ${e.message}`",
    "    }, { quoted: msg });",
    "  }",
    "",
    "  const tmp = ensureTmp();",
    "  const destino = path.join(tmp, `${Date.now()}_${safeName(command)}`);",
    "",
    "  let ultimoError;",
    "  let listo = '';",
    "",
    "  for (const url of enlaces.slice(0, 4)) {",
    "    try {",
    "      await descargar(url, destino);",
    "      listo = url;",
    "      break;",
    "    } catch (e) {",
    "      ultimoError = e;",
    "      try { fs.unlinkSync(destino); } catch {}",
    "    }",
    "  }",
    "",
    "  if (!listo) {",
    "    return conn.sendMessage(chatId, {",
    "      contextInfo: canal(),",
    "      text: `❌ No pude descargar el archivo: ${ultimoError?.message || 'sin enlaces válidos'}`",
    "    }, { quoted: msg });",
    "  }",
    "",
    "  const sizeMB = fs.statSync(destino).size / (1024 * 1024);",
    "",
    "  if (sizeMB > MAX_MB) {",
    "    try { fs.unlinkSync(destino); } catch {}",
    "    return conn.sendMessage(chatId, {",
    "      contextInfo: canal(),",
    "      text: `❌ El archivo pesa ${sizeMB.toFixed(1)}MB y el límite son ${MAX_MB}MB.`",
    "    }, { quoted: msg });",
    "  }",
    "",
    "  const esVideo = /\\.(mp4|mkv|webm|m4v|mov)(\\?|$)/i.test(listo);",
    "  const esAudio = /\\.(mp3|m4a|opus|ogg|wav|flac)(\\?|$)/i.test(listo);",
    "  const esImagen = /\\.(jpg|jpeg|png|webp)(\\?|$)/i.test(listo);",
    "",
    "  const extension = (listo.split('?')[0].split('.').pop() || 'bin').slice(0, 5);",
    "  const nombre = `${safeName(command)}_${Date.now()}.${extension}`;",
    "",
    "  const contenido = esVideo",
    "    ? { video: { url: destino }, mimetype: 'video/mp4', fileName: nombre }",
    "    : esAudio",
    "      ? { audio: { url: destino }, mimetype: 'audio/mpeg', ptt: false, fileName: nombre }",
    "      : esImagen",
    "        ? { image: { url: destino } }",
    "        : { document: { url: destino }, mimetype: 'application/octet-stream', fileName: nombre };",
    "",
    "  await conn.sendMessage(chatId, { ...contenido, contextInfo: canal() }, { quoted: msg });",
    "  await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } });",
    "",
    "  try { fs.unlinkSync(destino); } catch {}",
    "};",
    "",
    "handler.command = [" + JSON.stringify(comando) + "];",
    "handler.help = [" + JSON.stringify(comando + " <enlace>") + "];",
    "handler.tags = ['descargas'];",
    "",
    "export default handler;",
    ""
  ];

  return { comando, codigo: lineas.join("\n") };
}

// ---------- main ----------
const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  if (!esOwner(msg)) {
    return conn.sendMessage(
      chatId,
      { contextInfo: canal(), text: "⛔ *Solo los dueños del bot pueden usar este comando.*" },
      { quoted: msg }
    );
  }

  const analizado = normalizarUrl(args[0]);
  const objetivo = analizado?.url;
  const urlPrueba = (args[1] || "").trim();

  if (!objetivo) {
    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`🔎 *CRACK — analizador de webs de descarga*

Busca cómo pide el archivo una página, para poder pedírselo directo desde el bot.

*Uso:*
${pref}${command} <url del sitio>
${pref}${command} <url del sitio> <enlace de prueba>

*Ejemplos:*
${pref}${command} ssstik.io
${pref}${command} ssstik.io https://www.tiktok.com/@user/video/123

Con el enlace de prueba lo comprueba de verdad y, si funciona, te manda el
plugin ya escrito listo para subir a la carpeta de comandos.`
      },
      { quoted: msg }
    );
  }

  if (!esHostPublico(objetivo)) {
    return conn.sendMessage(
      chatId,
      { contextInfo: canal(), text: "❌ Esa dirección es de red interna y no se puede analizar." },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "🔎", key: msg.key } });

  // 1) la página
  let base = objetivo.toString();
  let portada = null;
  let fallo = null;

  const intentos = [base];
  if (analizado.inferido) intentos.push(base.replace(/^https:/i, "http:"));

  for (const intento of intentos) {
    try {
      const r = await pedir(intento, { cabeceras: { Accept: "text/html,*/*" } });
      if (r.status >= 400) throw new Error("HTTP " + r.status);

      portada = r;
      base = intento;
      break;
    } catch (e) {
      fallo = e;
    }
  }

  if (!portada) {
    return conn.sendMessage(
      chatId,
      { contextInfo: canal(), text: `❌ No pude abrir el sitio: ${fallo?.message || "sin respuesta"}` },
      { quoted: msg }
    );
  }

  const html = String(portada.data || "");
  const $ = cheerio.load(html);

  // Muchos sitios solo responden si llevas su cookie de sesión y su token.
  const cookies = (portada.headers?.["set-cookie"] || [])
    .map((c) => String(c).split(";")[0])
    .join("; ");

  const csrf =
    $('meta[name="csrf-token"]').attr("content") ||
    $('input[name="_token"]').attr("value") ||
    $('input[name="csrf_token"]').attr("value") ||
    "";

  // 2) formularios y scripts
  const formularios = analizarFormularios($, base);
  const fuentes = [{ texto: html, origen: "html" }];

  $("script").each((_, el) => {
    const dentro = $(el).html();
    if (dentro && dentro.length > 30) fuentes.push({ texto: dentro, origen: "script inline" });
  });

  const externos = [];
  $("script[src]").each((_, el) => {
    const src = absoluto($(el).attr("src"), base);
    if (src && !RUIDO.test(src)) externos.push(src);
  });

  for (const src of externos.slice(0, MAX_SCRIPTS)) {
    try {
      const r = await pedir(src, { referer: base });
      if (r.status < 400) fuentes.push({ texto: String(r.data || ""), origen: src.split("/").pop() });
    } catch {}
  }

  const globales = variablesGlobales(fuentes);
  const desdeLlamadas = analizarLlamadas(fuentes, base, globales);
  const desdeJs = analizarScripts(fuentes, base);

  // El captcha puede estar en un script externo, no solo en el HTML.
  const todoElTexto = fuentes.map((f) => f.texto).join("\n");
  const { avisos: protecciones, bloqueante } = detectarProtecciones(todoElTexto, portada.headers);

  const manual = normalizarUrl(args[2] || "");

  const candidatos = [
    ...(manual ? [{ url: manual.url.toString(), via: "endpoint que me diste", puntos: 100 }] : []),
    ...desdeLlamadas,
    ...formularios.map((f) => ({
      url: f.action,
      via: "formulario " + f.metodo.toUpperCase(),
      campos: f.campos,
      puntos: 10
    })),
    ...desdeJs
  ]
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, MAX_CANDIDATOS);

  if (!candidatos.length) {
    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`❌ No encontré ningún punto de descarga en ${objetivo.host}.

Suele pasar cuando la página arma todo con JavaScript después de cargar.
Prueba con la URL exacta donde aparece el botón de descargar.`
      },
      { quoted: msg }
    );
  }

  // 3) informe
  const lista = candidatos
    .slice(0, 8)
    .map((c, i) => {
      const campos = c.campos ? `\n     campos: ${c.campos.map((x) => x.name).join(", ")}` : "";
      return `  ${i + 1}. [${c.via}] ${recortar(c.url, 110)}${campos}`;
    })
    .join("\n");

  let informe =
`🔎 *CRACK — ${objetivo.host}*

📋 *Candidatos encontrados* (${candidatos.length})
${lista}

📝 *Formularios:* ${formularios.length}   *Scripts revisados:* ${fuentes.length}`;

  if (protecciones.length) {
    informe += `\n\n⚠️ *Protecciones detectadas*\n${protecciones.map((p) => "  • " + p).join("\n")}`;
  }

  if (bloqueante) {
    informe += `\n\n🛑 *Este sitio no se puede automatizar*\n${bloqueante}\nPruebo igual por si el servidor no lo comprueba, pero lo normal es que rechace.`;
  }

  if (!urlPrueba) {
    informe += `\n\n💡 Para comprobarlos de verdad y recibir el plugin ya escrito:\n${pref}${command} ${args[0]} <enlace de prueba>\n\n🎯 Si ya sabes cuál es el bueno (lo viste en F12 → Red):\n${pref}${command} ${args[0]} <enlace> <endpoint>`;

    await conn.sendMessage(chatId, { contextInfo: canal(), text: informe }, { quoted: msg });
    return conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  }

  // 4) probar de verdad
  await conn.sendMessage(
    chatId,
    { contextInfo: canal(), text: `${informe}\n\n🧪 Probando los ${Math.min(candidatos.length, MAX_PRUEBAS)} mejores con tu enlace...` },
    { quoted: msg }
  );

  const ctx = {
    formularios,
    cookies,
    csrf,
    usados: 0,
    limite: Date.now() + LIMITE_PRUEBAS_MS
  };

  let ganador = null;

  for (const c of candidatos.slice(0, MAX_PRUEBAS)) {
    const r = await probarCandidato(c, urlPrueba, base, ctx);

    if (r.ok) {
      ganador = { candidato: c, ...r };
      break;
    }
  }

  if (!ganador) {
    const motivo = bloqueante
      ? `🛑 *Es el captcha.*\n${bloqueante}\n\nEste sitio hay que descartarlo: busca otro que no pida captcha.`
      : `Puede ser por:
  • token o cookie que hay que sacar de la página primero
  • que el endpoint real solo aparezca al pulsar el botón
  • que la página lo arme con JavaScript en el momento`;

    await conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`❌ Ninguno de los candidatos devolvió un enlace de descarga.

${motivo}

💡 Abre el sitio con F12 → pestaña *Red*, dale a descargar y mira qué
petición sale. Luego pásamela directa:
${pref}${command} ${args[0]} ${urlPrueba} <endpoint>

O pruébala al vuelo con:
${pref}get2 <endpoint> ${urlPrueba}`
      },
      { quoted: msg }
    );

    return conn.sendMessage(chatId, { react: { text: "⚠️", key: msg.key } });
  }

  const nombreSugerido = objetivo.host.split(".")[0].replace(/[^a-z0-9]/gi, "") || "descarga";
  const { comando, codigo } = generarPlugin({
    nombre: nombreSugerido,
    sitio: base,
    endpoint: ganador.candidato.url,
    intento: ganador.intento,
    esJson: ganador.esJson,
    necesitaSesion: !!(cookies || csrf)
  });

  const enlacesTexto = ganador.enlaces.slice(0, 3).map((e, i) => `  ${i + 1}. ${recortar(e, 110)}`).join("\n");

  await conn.sendMessage(
    chatId,
    {
      contextInfo: canal(),
      text:
`✅ *¡Funciona!*

🎯 *Endpoint:* ${recortar(ganador.candidato.url, 140)}
📮 *Cómo pedirlo:* ${ganador.intento.etiqueta}
🔑 *Campo del enlace:* ${ganador.intento.nombre}
📦 *Responde:* ${ganador.tipo || "?"} (HTTP ${ganador.status})

🔗 *Archivos que devolvió:*
${enlacesTexto}

📄 Te mando el comando ya escrito. Súbelo a *plugins/pluginsdescargas/* y
queda disponible como *${pref}${comando} <enlace>*.`
    },
    { quoted: msg }
  );

  await conn.sendMessage(
    chatId,
    {
      document: Buffer.from(codigo, "utf-8"),
      mimetype: "text/javascript",
      fileName: `${comando.charAt(0).toUpperCase() + comando.slice(1)}.js`
    },
    { quoted: msg }
  );

  return conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["crack"];
handler.help = ["crack <url del sitio> [enlace de prueba] [endpoint]"];
handler.tags = ["owner"];

export default handler;
