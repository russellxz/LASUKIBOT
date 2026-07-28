import { canal } from "../../disenos.js";
import fs from "fs";
import path from "path";
import {
  Sesion,
  normalizarUrl,
  esHostPublico,
  extraerEnlaces,
  pareceEnProgreso,
  urlDeProgreso,
  verificarEnlace,
  detectarChallenge,
  accionesDeSegundoPaso,
  ejecutarAccion,
  descargarArchivo,
  tipoDeArchivo,
  recortar,
  esperar
} from "../../libs/navegador.js";

// comandos/get2.js — Pide un archivo a cualquier endpoint y lo manda al chat.
//
// .get2 <enlace directo>                    baja el archivo y lo envía
// .get2 <endpoint> <enlace>                 POST {url: enlace}
// .get2 <endpoint> <enlace> campo=id        si el campo se llama distinto
// .get2 <endpoint> <enlace> campo=url sid=x campos extra que pida el sitio
//
// Opciones: --get --json --doc --ver --sinsesion --espera=90
//
// Solo owner: hace peticiones salientes desde el servidor del bot.

"use strict";

const MAX_MB = 200;
const MAX_ENLACES = 6;
const ESPERA_POR_DEFECTO = 90;
const PASO_ESPERA = 3000;

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

function safeName(nombre = "archivo") {
  return String(nombre).slice(0, 60).replace(/[^\w.\-]+/g, "_") || "archivo";
}

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

// ---------- pedir al endpoint, esperando si hace falta ----------
async function pedirConEspera(sesion, { endpoint, cuerpo, metodo, comoJson, referer, segundos, avisar }) {
  const query = new URLSearchParams(cuerpo).toString();
  const limite = Date.now() + segundos * 1000;

  let vuelta = 0;
  let ultima = null;
  let siguiente = null;

  while (Date.now() < limite || vuelta === 0) {
    const url =
      siguiente ||
      (metodo === "get" ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}` : endpoint);

    const res = await sesion.pedir(url, {
      metodo: siguiente ? "get" : metodo,
      datos: siguiente || metodo === "get" ? undefined : comoJson ? JSON.stringify(cuerpo) : query,
      tipo: "xhr",
      referer,
      cabeceras: siguiente || metodo === "get"
        ? {}
        : { "Content-Type": comoJson ? "application/json" : "application/x-www-form-urlencoded" }
    });

    const texto = String(res.data || "");
    const { json, enlaces } = extraerEnlaces(texto, endpoint);

    ultima = { res, texto, json, enlaces, url, vueltas: vuelta + 1 };

    if (enlaces.length) return ultima;
    if (res.status >= 400) return ultima;
    if (!pareceEnProgreso(texto, json)) return ultima;

    // El sitio está trabajando: seguimos su URL de progreso si la da, y si no
    // repetimos la misma petición hasta que suelte el enlace.
    siguiente = siguiente || urlDeProgreso(texto, endpoint);

    vuelta++;
    if (vuelta === 1 && avisar) await avisar();
    if (Date.now() + PASO_ESPERA >= limite) break;

    await esperar(PASO_ESPERA);
  }

  return ultima;
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
  const sinSesion = opciones.includes("--sinsesion");

  const opEspera = opciones.find((o) => o.startsWith("--espera="));
  const segundos = Math.min(Math.max(Number(opEspera?.split("=")[1]) || ESPERA_POR_DEFECTO, 0), 240);

  const analizado = normalizarUrl(sueltos[0]);

  if (!analizado) {
    return conn.sendMessage(
      chatId,
      {
        contextInfo: canal(),
        text:
`📥 *GET2 — pide un archivo a cualquier endpoint*

*1) Enlace directo a un archivo*
${pref}${command} https://cdn.sitio.com/video.mp4

*2) Endpoint + el enlace que quieres bajar*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx

*3) Si el campo no se llama "url"*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx campo=id

*4) Con campos extra que pida el sitio*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx campo=url sid=abc

*5) Si la cookie la da otra página (lo normal)*
${pref}${command} https://sitio.com/api/dl https://youtu.be/xxxxx desde=https://sitio.com/youtube/

*Opciones*
  --get         mandarlo por GET en vez de POST
  --json        mandar el cuerpo como JSON
  --doc         enviarlo como documento
  --ver         enseñar qué responde, sin descargar
  --espera=90   segundos a esperar si el sitio va procesando
  --sinsesion   no cargar la portada antes (más rápido, menos compatible)`
      },
      { quoted: msg }
    );
  }

  const objetivo = analizado.url;

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
  const sesion = new Sesion();

  let campoUrl = "url";
  let desde = "";
  const extras = {};

  for (const par of sueltos.slice(2)) {
    const i = par.indexOf("=");
    if (i < 1) continue;

    const clave = par.slice(0, i);
    const valor = par.slice(i + 1);

    if (clave.toLowerCase() === "campo") campoUrl = valor;
    else if (clave.toLowerCase() === "desde") desde = valor;
    else extras[clave] = valor;
  }

  // Cargar la página primero: así el bot lleva la cookie de sesión y el token
  // que el sitio espera, igual que si hubieras entrado con el navegador.
  //
  // Importante cuál se carga: la cookie suele darla la página del formulario
  // (/youtube-to-mp4/), no la raíz del dominio. Pidiéndola a la raíz el sitio
  // contestaba 403 aunque el endpoint fuera el correcto.
  const paginaSesion = desde || objetivo.origin + "/";

  if (enlace && !sinSesion) {
    try {
      await sesion.abrir(paginaSesion);
    } catch {}
  }

  const tmp = ensureTmp();
  const destino = path.join(tmp, `${Date.now()}_get2`);
  let candidatos = [];
  const referer = paginaSesion;

  if (!enlace) {
    candidatos = [endpoint];
  } else {
    let resultado;

    try {
      resultado = await pedirConEspera(sesion, {
        endpoint,
        cuerpo: { ...extras, [campoUrl]: enlace },
        metodo: forzarGet ? "get" : "post",
        comoJson,
        referer,
        segundos,
        avisar: async () => {
          await conn.sendMessage(
            chatId,
            { contextInfo: canal(), text: `⏳ El sitio está procesando. Esperando hasta ${segundos}s a que suelte el enlace...` },
            { quoted: msg }
          );
        }
      });
    } catch (e) {
      return conn.sendMessage(
        chatId,
        { contextInfo: canal(), text: `❌ No pude llamar al endpoint: ${e.message}` },
        { quoted: msg }
      );
    }

    const { res, texto, enlaces, vueltas } = resultado;

    if (soloVer) {
      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`🔬 *Respuesta de ${objetivo.host}*

📮 ${(forzarGet ? "GET" : "POST")}${comoJson ? " json" : " form"} · campo *${campoUrl}*${Object.keys(extras).length ? " · extras: " + Object.keys(extras).join(", ") : ""}
📦 HTTP ${res.status} · ${String(res.headers?.["content-type"] || "?").split(";")[0]}${vueltas > 1 ? ` · ${vueltas} consultas` : ""}
🍪 Cookie enviada: ${sesion.cookieDe(objetivo.host) ? "sí" : "no"}${sesion.csrf ? " · token: sí" : ""}
🔗 Enlaces encontrados: ${enlaces.length}

${enlaces.slice(0, 5).map((e, i) => `  ${i + 1}. ${recortar(e, 110)}`).join("\n") || "  (ninguno)"}

📄 *Empieza así:*
${recortar(texto, 500)}`
        },
        { quoted: msg }
      );
    }

    if (res.status >= 400) {
      const bloqueo = detectarChallenge(res, texto);

      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`❌ El sitio respondió HTTP ${res.status}.${bloqueo ? `\n\n🛑 *${bloqueo}*` : ""}

${recortar(texto, 300)}

💡 Prueba a cambiar cómo se manda:
  ${pref}${command} ${sueltos[0]} ${enlace} --json
  ${pref}${command} ${sueltos[0]} ${enlace} --get
  ${pref}${command} ${sueltos[0]} ${enlace} campo=id`
        },
        { quoted: msg }
      );
    }

    // Muchas webs no dan el archivo en la primera respuesta: hay que pulsar
    // "descargar", que es una segunda petición. La buscamos y la seguimos.
    let enlacesFinales = enlaces;
    let paso2Usado = null;

    if (!enlaces.length) {
      const acciones = accionesDeSegundoPaso(texto, endpoint);

      for (const accion of acciones.slice(0, 6)) {
        try {
          const res2 = await ejecutarAccion(sesion, accion, referer);
          if (res2.status >= 400) continue;

          const cuerpo2 = String(res2.data || "");
          const { enlaces: e2 } = extraerEnlaces(cuerpo2, accion.url);
          if (!e2.length) continue;

          enlacesFinales = e2;
          paso2Usado = accion;
          break;
        } catch {}
      }

      if (paso2Usado) {
        await conn.sendMessage(
          chatId,
          {
            contextInfo: canal(),
            text: `🔁 El archivo no venía en la primera respuesta. Segundo paso: *${paso2Usado.metodo.toUpperCase()} ${recortar(paso2Usado.url, 70)}* → ${enlacesFinales.length} enlace(s).`
          },
          { quoted: msg }
        );
      }
    }

    if (!enlacesFinales.length) {
      const bloqueo = detectarChallenge(res, texto);

      return conn.sendMessage(
        chatId,
        {
          contextInfo: canal(),
          text:
`❌ El endpoint respondió (HTTP ${res.status}${vueltas > 1 ? `, tras ${vueltas} consultas` : ""}) pero no traía ningún enlace de descarga.${bloqueo ? `\n\n🛑 *${bloqueo}*` : ""}

📄 *Esto fue lo que devolvió:*
${recortar(texto, 600)}

💡 Si el sitio tarda más, sube la espera:
${pref}${command} ${sueltos[0]} ${enlace} --espera=180

Y para ver la respuesta entera:
${pref}${command} ${sueltos[0]} ${enlace} --ver`
        },
        { quoted: msg }
      );
    }

    candidatos = enlacesFinales.slice(0, MAX_ENLACES);
  }

  // ---- comprobar y descargar ----
  let usado = "";
  let info = null;
  const rechazados = [];

  for (const url of candidatos) {
    const check = await verificarEnlace(url, sesion, referer);

    if (!check.ok) {
      rechazados.push(`${recortar(url, 60)} → ${check.motivo}`);
      continue;
    }

    if (check.tamaño && check.tamaño / (1024 * 1024) > MAX_MB) {
      rechazados.push(`${recortar(url, 60)} → pesa ${(check.tamaño / (1024 * 1024)).toFixed(1)}MB`);
      continue;
    }

    try {
      info = await descargarArchivo(url, destino, sesion, referer);
      usado = url;
      break;
    } catch (e) {
      rechazados.push(`${recortar(url, 60)} → ${e.message}`);
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

${rechazados.slice(0, 4).map((r) => "  • " + r).join("\n")}

💡 Si el enlace bueno estaba ahí pero lo descarté, pásamelo suelto:
${pref}${command} <ese enlace>`
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
  const ext = (usado.split("?")[0].split(".").pop() || "").toLowerCase();
  const extension = ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? ext : "bin";
  const nombre = `${safeName(objetivo.host)}_${Date.now()}.${extension}`;

  const contenido =
    clase === "video"
      ? { video: { url: destino }, mimetype: "video/mp4", fileName: nombre }
      : clase === "audio"
        ? { audio: { url: destino }, mimetype: "audio/mpeg", ptt: false, fileName: nombre }
        : clase === "imagen"
          ? { image: { url: destino } }
          : { document: { url: destino }, mimetype: info.tipo || "application/octet-stream", fileName: nombre };

  await conn.sendMessage(chatId, { ...contenido, contextInfo: canal() }, { quoted: msg });

  const receta = enlace
    ? `\n\n💡 Para dejarlo fijo como comando:\n${pref}crack ${objetivo.origin} ${enlace} ${endpoint}`
    : "";

  await conn.sendMessage(
    chatId,
    {
      contextInfo: canal(),
      text: `✅ *Descargado*\n\n📦 ${sizeMB.toFixed(2)} MB · ${info.tipo || "?"} · enviado como ${clase}\n🔗 ${recortar(usado, 180)}${receta}`
    },
    { quoted: msg }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  try { fs.unlinkSync(destino); } catch {}
};

handler.command = ["get2"];
handler.help = ["get2 <endpoint> [enlace] [campo=valor] [--ver]"];
handler.tags = ["owner"];

export default handler;
