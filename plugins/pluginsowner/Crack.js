import { canal } from "../../disenos.js";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import {
  Sesion,
  normalizarUrl,
  esHostPublico,
  absoluto,
  recortar,
  extraerEnlaces,
  pareceEnProgreso,
  verificarEnlace,
  detectarChallenge,
  accionesDeSegundoPaso,
  ejecutarAccion,
  esperar
} from "../../libs/navegador.js";

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

const TIMEOUT_PRUEBA = 20000;
const MAX_SCRIPTS = 10;
const MAX_CANDIDATOS = 12;
const MAX_PRUEBAS = 5;
const MAX_INTENTOS = 28;
const LIMITE_PRUEBAS_MS = 180000;
const MAX_ACCIONES_PASO2 = 6;

const EXT_MEDIA = /\.(mp4|mkv|webm|m4v|mov|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|gif|pdf|zip|apk|rar)(\?|$)/i;

// ---------- utils ----------
function esOwner(msg) {
  if (msg.key.fromMe) return true;

  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");

  try {
    const ownerPath = path.resolve("owner.json");
    const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
    return owners.some(([id]) => id === senderId);
  } catch {
    return false;
  }
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

// Espera si el sitio contesta "procesando" en vez de dar el enlace.
async function pedirEsperando(sesion, url, intento, base, limite) {
  let vuelta = 0;

  while (true) {
    const res = await sesion.pedir(url, {
      metodo: intento.metodo,
      datos: intento.metodo === "get" ? undefined : intento.datos,
      tipo: "xhr",
      referer: base,
      timeout: TIMEOUT_PRUEBA,
      cabeceras: intento.cabeceras || {}
    });

    const cuerpo = String(res.data || "");
    const { json, enlaces } = extraerEnlaces(cuerpo, base);

    if (enlaces.length || res.status >= 400) return { res, cuerpo, json, enlaces };
    if (!pareceEnProgreso(cuerpo, json)) return { res, cuerpo, json, enlaces };
    if (vuelta >= 8 || Date.now() + 4000 > limite) return { res, cuerpo, json, enlaces };

    vuelta++;
    await esperar(4000);
  }
}

// Comprueba que el enlace sea un archivo, no una página que lo parezca.
async function primerArchivo(enlaces, ctx, base) {
  let motivo = "";

  for (const enlace of enlaces.slice(0, 5)) {
    const check = await verificarEnlace(enlace, ctx.sesion, base);

    if (check.ok) return { url: enlace, tipo: check.tipo, tamaño: check.tamaño };

    motivo = motivo || `${recortar(enlace, 55)} → ${check.motivo}`;
  }

  return { motivo };
}

async function probarCandidato(candidato, urlPrueba, base, ctx) {
  for (const intento of intentosPara(candidato, urlPrueba, ctx.formularios)) {
    if (ctx.usados >= MAX_INTENTOS || Date.now() > ctx.limite) break;
    ctx.usados++;

    try {
      const url = candidato.url + (intento.sufijo || "");
      const { res, cuerpo, json, enlaces } = await pedirEsperando(ctx.sesion, url, intento, base, ctx.limite);

      ctx.diario.push({
        paso: 1,
        metodo: intento.etiqueta,
        url,
        campos: intento.cuerpo,
        status: res.status,
        tipo: String(res.headers?.["content-type"] || "").split(";")[0],
        enlaces: enlaces.length,
        respuesta: recortar(cuerpo, 700)
      });

      const bloqueo = detectarChallenge(res, cuerpo);
      if (bloqueo) {
        ctx.bloqueos.push(`${recortar(url, 45)} → ${bloqueo}`);
        continue;
      }

      if (res.status >= 400) continue;

      // ---- el archivo puede estar ya aquí ----
      if (enlaces.length) {
        const archivo = await primerArchivo(enlaces, ctx, base);

        if (archivo.url) {
          return {
            ok: true,
            intento,
            status: res.status,
            tipo: String(res.headers?.["content-type"] || "").split(";")[0],
            esJson: !!json,
            enlaces,
            verificado: archivo,
            muestra: recortar(cuerpo, 400)
          };
        }

        ctx.falsosPositivos.push(`${recortar(candidato.url, 40)} [${intento.etiqueta}] → ${archivo.motivo}`);
      }

      // ---- y si no, casi seguro hace falta un segundo paso ----
      const acciones = accionesDeSegundoPaso(cuerpo, url);

      for (const accion of acciones.slice(0, MAX_ACCIONES_PASO2)) {
        if (ctx.usados >= MAX_INTENTOS || Date.now() > ctx.limite) break;
        ctx.usados++;

        try {
          const res2 = await ejecutarAccion(ctx.sesion, accion, url);
          const cuerpo2 = String(res2.data || "");
          const { json: json2, enlaces: enlaces2 } = extraerEnlaces(cuerpo2, accion.url);

          ctx.diario.push({
            paso: 2,
            metodo: `${accion.metodo.toUpperCase()} (${accion.tipo})`,
            url: accion.url,
            campos: accion.campos,
            status: res2.status,
            tipo: String(res2.headers?.["content-type"] || "").split(";")[0],
            enlaces: enlaces2.length,
            respuesta: recortar(cuerpo2, 700)
          });

          if (res2.status >= 400 || !enlaces2.length) continue;

          const archivo2 = await primerArchivo(enlaces2, ctx, accion.url);
          if (!archivo2.url) continue;

          return {
            ok: true,
            intento,
            paso2: accion,
            status: res2.status,
            tipo: String(res2.headers?.["content-type"] || "").split(";")[0],
            esJson: !!json2,
            enlaces: enlaces2,
            verificado: archivo2,
            muestra: recortar(cuerpo2, 400)
          };
        } catch {}
      }
    } catch (e) {
      ctx.diario.push({ paso: 1, metodo: intento.etiqueta, url: candidato.url, error: e.message });
    }
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

// ---------- informe de diagnóstico ----------
// Todo lo que vio y probó, para poder mirarlo con calma cuando algo no sale.
function armarInforme({ sitio, candidatos, formularios, fuentes, globales, protecciones, bloqueante, ctx, ganador, urlPrueba }) {
  const l = [];
  const sep = "=".repeat(66);

  l.push(sep, `INFORME DE .crack — ${sitio}`, `Fecha: ${new Date().toISOString()}`, sep, "");

  l.push("## RESULTADO", "");
  if (ganador) {
    l.push(`FUNCIONA con ${ganador.candidato.url}`);
    l.push(`  metodo: ${ganador.intento.etiqueta}`);
    l.push(`  campos: ${JSON.stringify(ganador.intento.cuerpo)}`);
    if (ganador.paso2) {
      l.push(`  SEGUNDO PASO: ${ganador.paso2.metodo.toUpperCase()} ${ganador.paso2.url}`);
      l.push(`     campos: ${JSON.stringify(ganador.paso2.campos)}`);
    }
    l.push(`  archivo: ${ganador.verificado?.url || "?"}`);
    l.push(`  tipo: ${ganador.verificado?.tipo || "?"}`);
  } else {
    l.push("NO se pudo obtener el archivo.");
  }
  l.push("");

  if (bloqueante) l.push("## BLOQUEO PRINCIPAL", bloqueante, "");
  if (protecciones.length) l.push("## PROTECCIONES", ...protecciones.map((x) => "  - " + x), "");
  if (ctx.bloqueos.length) l.push("## RECHAZOS DEL SERVIDOR", ...ctx.bloqueos.map((x) => "  - " + x), "");
  if (ctx.falsosPositivos.length) l.push("## ENLACES QUE NO ERAN ARCHIVOS", ...ctx.falsosPositivos.map((x) => "  - " + x), "");

  l.push("## CANDIDATOS ENCONTRADOS", "");
  candidatos.forEach((c, i) => {
    l.push(`${i + 1}. [${c.via}] ${c.url}`);
    if (c.campos?.length) {
      l.push(`   campos: ${c.campos.map((x) => x.name + (x.valor ? `="${x.valor}"` : "")).join(", ")}`);
    }
    if (c.origen) l.push(`   visto en: ${c.origen}`);
  });
  l.push("");

  l.push("## FORMULARIOS DE LA PAGINA", "");
  formularios.forEach((f, i) => {
    l.push(`${i + 1}. ${f.metodo.toUpperCase()} ${f.action}`);
    f.campos.forEach((c) => l.push(`   - ${c.name} (${c.tipo})${c.valor ? ` = "${c.valor}"` : ""}`));
  });
  if (!formularios.length) l.push("  (ninguno)");
  l.push("");

  const vars = Object.entries(globales);
  if (vars.length) {
    l.push("## VARIABLES DE LA PAGINA", "");
    vars.slice(0, 40).forEach(([k, v]) => l.push(`  ${k} = "${recortar(v, 80)}"`));
    l.push("");
  }

  l.push("## PETICIONES QUE SE HICIERON", "");
  if (!ctx.diario.length) l.push("  (ninguna: no se pasó enlace de prueba)");

  ctx.diario.forEach((d, i) => {
    l.push(`--- ${i + 1} (paso ${d.paso}) ---`);
    l.push(`  ${d.metodo} ${d.url}`);
    if (d.campos) l.push(`  campos: ${JSON.stringify(d.campos)}`);
    if (d.error) {
      l.push(`  ERROR: ${d.error}`);
    } else {
      l.push(`  -> HTTP ${d.status} ${d.tipo || ""} · ${d.enlaces} enlace(s)`);
      l.push("  respuesta:");
      String(d.respuesta || "").split("\n").slice(0, 14).forEach((r) => l.push("    " + r));
    }
    l.push("");
  });

  l.push("## CODIGO DE LA PAGINA REVISADO", "");
  fuentes.forEach((f) => l.push(`  - ${f.origen} (${f.texto.length} caracteres)`));
  l.push("");

  l.push("## FRAGMENTOS DE LAS LLAMADAS ENCONTRADAS", "");
  const trozos = [];
  for (const f of fuentes) {
    const re = /(\$\.\s*(?:post|get|ajax)|fetch\s*\(|axios\s*\.\s*(?:get|post))/g;
    let m;
    while ((m = re.exec(f.texto)) !== null && trozos.length < 12) {
      trozos.push(`[${f.origen}]\n` + f.texto.slice(Math.max(0, m.index - 60), m.index + 320).trim());
    }
  }
  trozos.forEach((t) => l.push(t, "-".repeat(50)));
  if (!trozos.length) l.push("  (ninguno)");

  l.push("", sep, `Enlace de prueba usado: ${urlPrueba || "(ninguno)"}`, sep);

  return l.join("\n");
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

  // 1) la página, cargada con la misma sesión que usaremos después
  const sesion = new Sesion();

  let base = objetivo.toString();
  let portada = null;
  let html = "";
  let fallo = null;

  const intentos = [base];
  if (analizado.inferido) intentos.push(base.replace(/^https:/i, "http:"));

  for (const intento of intentos) {
    try {
      const r = await sesion.abrir(intento);
      if (r.res.status >= 400) throw new Error("HTTP " + r.res.status);

      portada = r.res;
      html = r.html;
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

  const $ = cheerio.load(html);

  // sesion.abrir ya guardó la cookie y el token: los reusa en cada petición.
  const cookies = sesion.cookieDe(objetivo.host);
  const csrf = sesion.csrf || $('input[name="_token"]').attr("value") || "";
  if (csrf) sesion.csrf = csrf;

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
      const r = await sesion.pedir(src, { referer: base, tipo: "xhr" });
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
    sesion,
    falsosPositivos: [],
    bloqueos: [],
    diario: [],
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
      : ctx.falsosPositivos.length
        ? `Algunos endpoints *sí respondieron*, pero los enlaces que daban no eran archivos descargables:\n${ctx.falsosPositivos.slice(0, 4).map((f) => "  • " + f).join("\n")}\n\nSuele significar que falta un paso: el sitio devuelve una página intermedia y el archivo aparece en una segunda petición.`
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

    await conn.sendMessage(
      chatId,
      {
        document: Buffer.from(
          armarInforme({ sitio: base, candidatos, formularios, fuentes, globales, protecciones, bloqueante, ctx, ganador: null, urlPrueba }),
          "utf-8"
        ),
        mimetype: "text/plain",
        fileName: `crack_${objetivo.host.replace(/[^\w.-]/g, "_")}.txt`
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

  // La orden get2 que reproduce exactamente lo que acaba de funcionar, para no
  // tener que adivinar los campos al probarlo a mano.
  const extrasGet2 = Object.entries(ganador.intento.cuerpo || {})
    .filter(([k]) => k !== ganador.intento.nombre)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  const banderas = [
    ganador.intento.metodo === "get" ? "--get" : "",
    ganador.intento.cabeceras?.["Content-Type"] === "application/json" ? "--json" : ""
  ].filter(Boolean).join(" ");

  const necesitaPagina = !!(cookies || csrf) || base !== objetivo.origin + "/";

  const ordenGet2 = [
    `${pref}get2`,
    ganador.candidato.url,
    urlPrueba,
    `campo=${ganador.intento.nombre}`,
    extrasGet2,
    necesitaPagina ? `desde=${base}` : "",
    banderas
  ].filter(Boolean).join(" ");

  const verificado = ganador.verificado || {};
  const pesoMB = verificado.tamaño ? ` · ${(verificado.tamaño / (1024 * 1024)).toFixed(1)} MB` : "";

  const textoPaso2 = ganador.paso2
    ? `\n\n🔁 *Hacen falta DOS pasos* (por eso antes fallaba):\n  1. ${ganador.intento.etiqueta} → ${recortar(ganador.candidato.url, 70)}\n  2. ${ganador.paso2.metodo.toUpperCase()} → ${recortar(ganador.paso2.url, 70)}\n     campos: ${recortar(Object.keys(ganador.paso2.campos).join(", "), 60) || "(ninguno)"}`
    : "";

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
${enlacesTexto}${textoPaso2}

✔️ *Comprobado:* el primero es un archivo de verdad (${verificado.tipo || "?"}${pesoMB}), no una página.

▶️ *Pruébalo cuando quieras con:*
${ordenGet2}

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

  await conn.sendMessage(
    chatId,
    {
      document: Buffer.from(
        armarInforme({ sitio: base, candidatos, formularios, fuentes, globales, protecciones, bloqueante, ctx, ganador, urlPrueba }),
        "utf-8"
      ),
      mimetype: "text/plain",
      fileName: `crack_${objetivo.host.replace(/[^\w.-]/g, "_")}.txt`
    },
    { quoted: msg }
  );

  return conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["crack"];
handler.help = ["crack <url del sitio> [enlace de prueba] [endpoint]"];
handler.tags = ["owner"];

export default handler;
