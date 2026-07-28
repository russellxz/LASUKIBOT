import { canal } from "../../disenos.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { promisify } from "util";
import { pipeline } from "stream";
const streamPipe = promisify(pipeline);

// comandos/get2.js — Pide un archivo a cualquier endpoint y lo manda al chat.
//
// La pareja de .crack: cuando ya sabes a qué URL hay que pedirle el archivo
// (porque te lo dijo .crack o lo viste en F12 → Red), .get2 la prueba al vuelo
// sin tener que escribir un plugin.
//
// .get2 <enlace directo>                    baja el archivo y lo envía
// .get2 <endpoint> <enlace>                 POST {url: enlace}, busca el archivo
// .get2 <endpoint> <enlace> campo=id        el campo del enlace se llama "id"
// .get2 <endpoint> <enlace> sid=abc lng=es  campos extra que pida el sitio
//
// Opciones: --get  --json  --doc  --ver
//
// Solo owner: hace peticiones salientes desde el servidor del bot.

"use strict";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMEOUT = 90000;
const TIMEOUT_DESCARGA = 300000;
const MAX_MB = 200;
const MAX_INTENTOS_ENLACE = 4;

const EXT_MEDIA = /\.(mp4|mkv|webm|m4v|mov|mp3|m4a|opus|ogg|wav|flac|jpg|jpeg|png|webp|gif|pdf|zip|apk|rar)(\?|$)/i;
const EXT_VIDEO = /\.(mp4|mkv|webm|m4v|mov)(\?|$)/i;
const EXT_AUDIO = /\.(mp3|m4a|opus|ogg|wav|flac)(\?|$)/i;
const EXT_IMAGEN = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i;

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

function normalizarUrl(entrada = "") {
  let u = String(entrada).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;

  try {
    return new URL(u);
  } catch {
    return null;
  }
}

// Igual que en .crack: sin esto el bot sería un puente hacia la red interna.
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

function recortar(texto, max = 300) {
  const t = String(texto ?? "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function safeName(nombre = "archivo") {
  return String(nombre).slice(0, 60).replace(/[^\w.\-]+/g, "_") || "archivo";
}

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
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

    $("a[href], source[src], video[src], audio[src], iframe[src]").each((_, el) => {
      const v = $(el).attr("href") || $(el).attr("src") || "";
      if (!v) return;

      try {
        const u = new URL(v, base).toString();
        if (EXT_MEDIA.test(u) || /(download|descarg|cdn|dl\?)/i.test(u)) encontrados.push(u);
      } catch {}
    });
  } catch {}

  return encontrados;
}

function buscarEnlaces(cuerpo, base) {
  let json = null;

  try {
    json = JSON.parse(cuerpo);
  } catch {}

  const enlaces = json ? enlacesDesdeJson(json) : enlacesDesdeHtml(cuerpo, base);

  // Los que apuntan a un archivo de verdad primero.
  return {
    json,
    enlaces: [...new Set(enlaces)].sort((a, b) => (EXT_MEDIA.test(b) ? 1 : 0) - (EXT_MEDIA.test(a) ? 1 : 0))
  };
}

// ---------- descarga ----------
async function descargar(url, destino, referer) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: TIMEOUT_DESCARGA,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      ...(referer ? { Referer: referer } : {})
    }
  });

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);

  const tipo = String(res.headers?.["content-type"] || "");
  if (/text\/html|application\/json/i.test(tipo)) {
    try { res.data.destroy(); } catch {}
    throw new Error(`devolvió ${tipo.split(";")[0]}, no un archivo`);
  }

  const esperado = Number(res.headers?.["content-length"] || 0);
  await streamPipe(res.data, fs.createWriteStream(destino));

  const real = fs.statSync(destino).size;
  if (!real) throw new Error("el archivo llegó vacío");
  if (esperado && real !== esperado) throw new Error(`descarga incompleta (${real} de ${esperado} bytes)`);

  return { tamaño: real, tipo: tipo.split(";")[0] };
}

// Por la cabecera, no por la extensión: muchos enlaces no tienen extensión.
function tipoDeArchivo(destino, url, contentType) {
  if (EXT_VIDEO.test(url) || /video\//i.test(contentType)) return "video";
  if (EXT_AUDIO.test(url) || /audio\//i.test(contentType)) return "audio";
  if (EXT_IMAGEN.test(url) || /image\//i.test(contentType)) return "imagen";

  try {
    const fd = fs.openSync(destino, "r");
    const b = Buffer.alloc(12);
    try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }

    if (b.slice(4, 8).toString("latin1") === "ftyp") return "video";
    if (b.slice(0, 3).toString("latin1") === "ID3") return "audio";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio";
    if (b[0] === 0xff && b[1] === 0xd8) return "imagen";
    if (b.slice(1, 4).toString("latin1") === "PNG") return "imagen";
  } catch {}

  return "documento";
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

  const opciones = args.filter((a) => a.startsWith("--")).map((a) => a.toLowerCase());
  const sueltos = args.filter((a) => !a.startsWith("--"));

  const forzarGet = opciones.includes("--get");
  const comoJson = opciones.includes("--json");
  const comoDoc = opciones.includes("--doc");
  const soloVer = opciones.includes("--ver");

  const objetivo = normalizarUrl(sueltos[0]);

  if (!objetivo) {
    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`📥 *GET2 — pide un archivo a cualquier endpoint*

La pareja de *${pref}crack*: cuando ya sabes a qué URL hay que pedirle el
archivo, esto lo prueba al momento sin escribir ningún plugin.

*1) Enlace directo a un archivo*
${pref}${command} https://cdn.sitio.com/video.mp4

*2) Endpoint + el enlace que quieres bajar*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx

*3) Si el campo no se llama "url"*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx campo=id

*4) Con campos extra que pida el sitio*
${pref}${command} https://sitio.com/ https://youtu.be/xxxxx campo=url sid=abc lngg=es

*Opciones*
  --get    mandarlo por GET en vez de POST
  --json   mandar el cuerpo como JSON
  --doc    enviarlo como documento
  --ver    solo enseñar qué responde, sin descargar`
      },
      { quoted: msg }
    );
  }

  if (!esHostPublico(objetivo)) {
    return conn.sendMessage(
      chatId,
      { contextInfo: canal(), text: "❌ Esa dirección es de red interna y no se puede usar." },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  const endpoint = objetivo.toString();
  const enlace = sueltos[1] || "";

  // campo=nombre elige cómo se llama el campo del enlace; el resto van tal cual
  let campoUrl = "url";
  const extras = {};

  for (const par of sueltos.slice(2)) {
    const i = par.indexOf("=");
    if (i < 1) continue;

    const clave = par.slice(0, i);
    const valor = par.slice(i + 1);

    if (clave.toLowerCase() === "campo") campoUrl = valor;
    else extras[clave] = valor;
  }

  const tmp = ensureTmp();
  const destino = path.join(tmp, `${Date.now()}_get2`);
  let candidatos = [];
  let origen = endpoint;

  // ---- caso 1: enlace directo, sin endpoint que consultar ----
  if (!enlace) {
    candidatos = [endpoint];
  } else {
    // ---- caso 2: preguntar al endpoint dónde está el archivo ----
    const cuerpo = { ...extras, [campoUrl]: enlace };
    const query = new URLSearchParams(cuerpo).toString();
    const metodo = forzarGet ? "get" : "post";

    let res;

    try {
      res = await axios({
        method: metodo,
        url: metodo === "get" ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}` : endpoint,
        data: metodo === "get" ? undefined : comoJson ? JSON.stringify(cuerpo) : query,
        timeout: TIMEOUT,
        maxRedirects: 5,
        responseType: "text",
        transformResponse: [(d) => d],
        validateStatus: () => true,
        headers: {
          "User-Agent": UA,
          "Content-Type": comoJson ? "application/json" : "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: objetivo.origin + "/",
          Origin: objetivo.origin,
          Accept: "*/*"
        }
      });
    } catch (e) {
      return conn.sendMessage(
        chatId,
        { contextInfo: canal(), text: `❌ No pude llamar al endpoint: ${e.message}` },
        { quoted: msg }
      );
    }

    const texto = String(res.data || "");
    const { enlaces } = buscarEnlaces(texto, endpoint);

    if (soloVer) {
      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`🔬 *Respuesta de ${objetivo.host}*

📮 ${metodo.toUpperCase()} · campo *${campoUrl}*${Object.keys(extras).length ? " · extras: " + Object.keys(extras).join(", ") : ""}
📦 HTTP ${res.status} · ${String(res.headers?.["content-type"] || "?").split(";")[0]}
🔗 Enlaces encontrados: ${enlaces.length}

${enlaces.slice(0, 5).map((e, i) => `  ${i + 1}. ${recortar(e, 110)}`).join("\n") || "  (ninguno)"}

📄 *Empieza así:*
${recortar(texto, 500)}`
        },
        { quoted: msg }
      );
    }

    if (res.status >= 400) {
      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`❌ El sitio respondió HTTP ${res.status}.

${recortar(texto, 300)}

💡 Prueba a cambiar cómo se manda:
  ${pref}${command} ${sueltos[0]} ${enlace} --json
  ${pref}${command} ${sueltos[0]} ${enlace} --get
  ${pref}${command} ${sueltos[0]} ${enlace} campo=id`
        },
        { quoted: msg }
      );
    }

    if (!enlaces.length) {
      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`❌ El endpoint respondió (HTTP ${res.status}) pero no traía ningún enlace de descarga.

📄 *Esto fue lo que devolvió:*
${recortar(texto, 600)}

💡 Si ves ahí el enlace pero no lo detecté, pásamelo directo:
${pref}${command} <ese enlace>

O mira la respuesta completa con:
${pref}${command} ${sueltos[0]} ${enlace} --ver`
        },
        { quoted: msg }
      );
    }

    candidatos = enlaces.slice(0, MAX_INTENTOS_ENLACE);
    origen = endpoint;
  }

  // ---- descargar el primero que funcione ----
  let usado = "";
  let info = null;
  let ultimoError;

  for (const url of candidatos) {
    try {
      info = await descargar(url, destino, origen);
      usado = url;
      break;
    } catch (e) {
      ultimoError = e;
      try { fs.unlinkSync(destino); } catch {}
    }
  }

  if (!usado) {
    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`❌ Encontré ${candidatos.length} enlace(s) pero ninguno se pudo descargar.

Último error: ${ultimoError?.message || "desconocido"}

🔗 ${recortar(candidatos[0] || "", 150)}`
      },
      { quoted: msg }
    );
  }

  const sizeMB = info.tamaño / (1024 * 1024);

  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(destino); } catch {}

    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text: `❌ El archivo pesa ${sizeMB.toFixed(1)}MB y el límite de WhatsApp son ${MAX_MB}MB.\n\n🔗 ${recortar(usado, 200)}`
      },
      { quoted: msg }
    );
  }

  const clase = comoDoc ? "documento" : tipoDeArchivo(destino, usado, info.tipo);
  const extension = (usado.split("?")[0].split(".").pop() || "").slice(0, 5);
  const nombre = `${safeName(objetivo.host)}_${Date.now()}.${extension && extension.length <= 5 ? extension : "bin"}`;

  const contenido =
    clase === "video"
      ? { video: { url: destino }, mimetype: "video/mp4", fileName: nombre }
      : clase === "audio"
        ? { audio: { url: destino }, mimetype: "audio/mpeg", ptt: false, fileName: nombre }
        : clase === "imagen"
          ? { image: { url: destino } }
          : { document: { url: destino }, mimetype: info.tipo || "application/octet-stream", fileName: nombre };

  await conn.sendMessage(chatId, { ...contenido, contextInfo: canal() }, { quoted: msg });

  await conn.sendMessage(
    chatId,
    {
      contextInfo: canal(),
      text:
`✅ *Descargado*

📦 ${sizeMB.toFixed(2)} MB · ${info.tipo || "?"} · enviado como ${clase}
🔗 ${recortar(usado, 180)}${enlace ? `\n\n💡 Para dejarlo fijo como comando:\n${pref}crack ${objetivo.origin} ${enlace} ${endpoint}` : ""}`
    },
    { quoted: msg }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  try { fs.unlinkSync(destino); } catch {}
};

handler.command = ["get2"];
handler.help = ["get2 <endpoint> [enlace] [campo=valor]"];
handler.tags = ["owner"];

export default handler;
