// libs/antiporno.js — Moderación automática de contenido +18 en grupos.
//
// Se llama por cada mensaje que llega. Si el grupo no tiene el antiporno
// activado no hace absolutamente nada, ni una petición: así el bot no delata
// que está mirando ni gasta la API.
//
// Cuando detecta contenido +18: borra el mensaje, avisa con el contador de
// avisos, y a la quinta vez expulsa a quien lo mandó.

"use strict";

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { setConfig, getConfig } from "../db.js";
import { analizarBuffer } from "./nsfwsky.js";

const ejecutar = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const UMBRAL = 70;          // % a partir del cual se considera +18
const AVISOS_MAX = 5;       // al quinto, fuera del grupo
const MAX_MB = 25;          // límite que acepta la API
const MAX_MB_DESCARGA = 120; // por encima de esto ni lo bajamos, para no reventar la RAM

// De un video largo no se manda el video: se sacan un par de fotos y se
// mandan como imagen. Pesa menos, la API no tiene que extraer fotogramas
// (funciona aunque su servidor no tenga ffmpeg) y cubre dos momentos
// separados en vez de cinco segundos seguidos.
const CAPTURAS = 2;
const CAPTURA_ANCHO = 640;
const CAPTURA_1 = 60;       // minuto 1: el principio de un video no dice nada
const CAPTURA_2 = 120;      // minuto 2
const DURACION_CORTA = 15;  // por debajo de esto se manda el video entero

// Si no se pueden sacar las fotos, se cae a un trozo de 5 s cortado con
// -c copy, que tampoco recodifica.
const CLIP_SEGUNDOS = 5;
const CLIP_DESDE = 60;

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function desenvolver(m) {
  let n = m;

  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }

  return n;
}

// Devuelve qué tipo de multimedia trae el mensaje, o null si no trae ninguno.
function multimediaDe(m) {
  const raiz = desenvolver(m);
  if (!raiz) return null;

  if (raiz.imageMessage) return { tipo: "image", nodo: raiz.imageMessage, nombre: "media.jpg" };
  if (raiz.stickerMessage) return { tipo: "sticker", nodo: raiz.stickerMessage, nombre: "media.webp" };

  if (raiz.videoMessage) {
    // Los GIF de WhatsApp son vídeos con gifPlayback.
    const nombre = raiz.videoMessage.gifPlayback ? "media.gif.mp4" : "media.mp4";
    return {
      tipo: "video",
      nodo: raiz.videoMessage,
      nombre,
      duracion: Number(raiz.videoMessage.seconds || 0)
    };
  }

  if (raiz.documentMessage && /^(image|video)\//i.test(raiz.documentMessage.mimetype || "")) {
    return { tipo: "document", nodo: raiz.documentMessage, nombre: raiz.documentMessage.fileName || "media" };
  }

  return null;
}

async function descargar(conn, nodo, tipo) {
  const baileys = await import("@whiskeysockets/baileys");
  const stream = await baileys.downloadContentFromMessage(nodo, tipo === "document" ? "document" : tipo);

  let buf = Buffer.alloc(0);
  for await (const trozo of stream) buf = Buffer.concat([buf, trozo]);

  return buf;
}

// ---------- recorte del video ----------
function borrar(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// En qué segundos sacar las fotos. Vacío = mandar el video entero (es corto).
function momentosDe(duracion) {
  if (!duracion || duracion <= DURACION_CORTA) return [];

  // Videos largos: el minuto 1 y el minuto 2, tal como se pidió.
  if (duracion > CAPTURA_2 + 10) return [CAPTURA_1, CAPTURA_2];

  // De 70 s a 2 min: el minuto 1 y un punto avanzado.
  if (duracion > CAPTURA_1 + 10) return [CAPTURA_1, Math.floor(duracion * 0.8)];

  // De 15 s a ~1 min: repartidos, evitando el principio.
  return [Math.floor(duracion * 0.35), Math.floor(duracion * 0.7)].slice(0, CAPTURAS);
}

// -ss delante de -i salta directo al segundo pedido sin descodificar lo
// anterior, y -vframes 1 saca una sola foto. Es lo más barato que hay.
async function sacarCaptura(entrada, segundo, salida) {
  await ejecutar(FFMPEG, [
    "-y",
    "-ss", String(segundo),   // antes de -i: salta sin descodificar lo anterior
    "-i", entrada,
    "-vframes", "1",
    "-vf", `scale=${CAPTURA_ANCHO}:-2`,
    "-q:v", "3",
    "-loglevel", "error",
    salida
  ], { timeout: 30000 });

  const foto = await fs.promises.readFile(salida);
  return foto.length > 1024 ? foto : null;
}

// Trozo de 5 s sin recodificar, por si las fotos no salen.
async function recortarVideo(entrada, inicio, salida) {
  await ejecutar(FFMPEG, [
    "-y",
    "-ss", String(inicio),
    "-i", entrada,
    "-t", String(CLIP_SEGUNDOS),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-loglevel", "error",
    salida
  ], { timeout: 60000 });

  const clip = await fs.promises.readFile(salida);
  return clip.length > 2048 ? clip : null;
}

/**
 * Qué mandar a la API para un video. Devuelve una lista de muestras, porque
 * de un video largo se miran varios momentos y vale el peor.
 */
async function muestrasDeVideo(buffer, duracion) {
  const momentos = momentosDe(duracion);

  if (!momentos.length) {
    return [{ datos: buffer, nombre: "media.mp4", nota: "video completo" }];
  }

  const base = path.join(os.tmpdir(), `ap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const entrada = `${base}_in.mp4`;
  const temporales = [entrada];

  try {
    await fs.promises.writeFile(entrada, buffer);

    // 1) lo normal: un par de fotos
    const muestras = [];

    for (let i = 0; i < momentos.length && i < CAPTURAS; i++) {
      const salida = `${base}_${i}.jpg`;
      temporales.push(salida);

      try {
        const foto = await sacarCaptura(entrada, momentos[i], salida);
        if (foto) {
          muestras.push({
            datos: foto,
            nombre: `captura_${i + 1}.jpg`,
            nota: `captura del segundo ${momentos[i]}`
          });
        }
      } catch (e) {
        console.error(`[antiporno] no pude capturar el segundo ${momentos[i]}:`, e?.message || e);
      }
    }

    if (muestras.length) return muestras;

    // 2) respaldo: un trozo de 5 s
    const salidaClip = `${base}_clip.mp4`;
    temporales.push(salidaClip);

    try {
      const clip = await recortarVideo(entrada, Math.min(CLIP_DESDE, momentos[0]), salidaClip);
      if (clip) {
        return [{ datos: clip, nombre: "media.mp4", nota: `${CLIP_SEGUNDOS}s de video` }];
      }
    } catch (e) {
      console.error("[antiporno] tampoco pude recortar:", e?.message || e);
    }

    // 3) último recurso: el video tal cual
    return [{ datos: buffer, nombre: "media.mp4", nota: "video completo (ffmpeg no disponible)" }];
  } catch (e) {
    console.error("[antiporno] error preparando el video:", e?.message || e);
    return [{ datos: buffer, nombre: "media.mp4", nota: "video completo" }];
  } finally {
    for (const t of temporales) borrar(t);
  }
}

// El bot principal guarda su configuración en activos.db; cada subbot tiene la
// suya. Se usa la que corresponda según con qué conexión nos llamen.
function configDe(conn) {
  if (typeof conn?.getSubConfig === "function" && typeof conn?.setSubConfig === "function") {
    return {
      leer: (chatId, clave) => conn.getSubConfig(chatId, clave),
      guardar: (chatId, clave, valor) => conn.setSubConfig(chatId, clave, valor)
    };
  }

  return { leer: getConfig, guardar: setConfig };
}

// Cuántos avisos lleva ya esta persona en este grupo.
function avisosDe(cfg, chatId, numero) {
  return parseInt(cfg.leer(chatId, `antiporno_avisos_${numero}`)) || 0;
}

function guardarAvisos(cfg, chatId, numero, n) {
  cfg.guardar(chatId, `antiporno_avisos_${numero}`, n);
}

/**
 * Revisa un mensaje y actúa si trae contenido +18.
 * @returns {Promise<boolean>} true si borró el mensaje.
 */
export async function revisarNsfw(conn, m, { owners = [] } = {}) {
  try {
    const chatId = m?.key?.remoteJid;

    if (!chatId || !chatId.endsWith("@g.us")) return false;   // solo grupos
    if (m.key.fromMe) return false;                            // nunca al propio bot

    const cfg = configDe(conn);

    // Si no está activado, ni miramos el mensaje.
    if (Number(cfg.leer(chatId, "antiporno")) !== 1) return false;

    const media = multimediaDe(m.message);
    if (!media) return false;

    // Los dueños del bot se saltan el filtro.
    const autorJid = m.realJid || m.key.participant || chatId;
    const autorNum = DIGITS(String(m.realNumber || autorJid).split(":")[0]);

    if (owners.some((o) => DIGITS(Array.isArray(o) ? o[0] : o) === autorNum)) return false;

    // Solo se descarta lo desmesurado, para no cargarlo entero en memoria.
    // Antes el corte estaba en 25 MB y por eso los videos no se analizaban:
    // muchos pasan de ahí y se descartaban sin decir nada.
    const bytes = Number(media.nodo?.fileLength || 0);
    if (bytes && bytes > MAX_MB_DESCARGA * 1024 * 1024) {
      console.log(`[antiporno] descartado: pesa ${(bytes / 1024 / 1024).toFixed(1)} MB`);
      return false;
    }

    const buffer = await descargar(conn, media.nodo, media.tipo);
    if (!buffer?.length) return false;

    // De un video se sacan un par de fotos; una imagen o un sticker van tal cual.
    const muestras =
      media.tipo === "video"
        ? await muestrasDeVideo(buffer, media.duracion)
        : [{ datos: buffer, nombre: media.nombre, nota: "" }];

    // Se mira cada muestra y vale la peor, igual que hace la API con los
    // fotogramas de un video. En cuanto una da +18 paramos: ya está decidido
    // y no hace falta gastar otra petición.
    let r = null;
    let nota = "";
    let fallo = null;

    for (const muestra of muestras) {
      if (muestra.datos.length > MAX_MB * 1024 * 1024) {
        console.log(`[antiporno] muestra descartada: ${(muestra.datos.length / 1024 / 1024).toFixed(1)} MB pasa el límite de la API`);
        continue;
      }

      const parcial = await analizarBuffer(muestra.datos, { nombre: muestra.nombre, umbral: UMBRAL });

      if (!parcial.ok) {
        fallo = parcial;
        continue;
      }

      if (!r || parcial.percent > r.percent) {
        r = parcial;
        nota = muestra.nota;
      }

      if (parcial.esNsfw) break;
    }

    // Si la API falla NO borramos: mejor dejar pasar algo dudoso que cargarse
    // una foto normal porque el servidor estaba caído.
    if (!r) {
      if (fallo) console.error("[antiporno]", fallo.code, fallo.error);
      return false;
    }

    console.log(`[antiporno] ${chatId} · ${r.tipo}${nota ? ` (${nota})` : ""} · ${r.porcentaje}% (${r.veredicto})`);

    if (!r.esNsfw) return false;

    // ---- borrar ----
    try {
      await conn.sendMessage(chatId, { delete: m.key });
    } catch (e) {
      console.error("[antiporno] no pude borrar (¿el bot no es admin?):", e.message);

      await conn.sendMessage(chatId, {
        text: `🔞 *Contenido +18 detectado* (${r.porcentaje}%)\n\n⚠️ No puedo borrarlo porque no soy administrador del grupo.`
      });

      return false;
    }

    // ---- avisar y contar ----
    const avisos = avisosDe(cfg, chatId, autorNum) + 1;
    guardarAvisos(cfg, chatId, autorNum, avisos);

    const mencion = `@${autorNum}`;

    if (avisos >= AVISOS_MAX) {
      await conn.sendMessage(chatId, {
        text:
`🔞 *CONTENIDO +18 ELIMINADO*

👤 Usuario: ${mencion}
📊 Detección: *${r.porcentaje}%* (${r.veredicto})
📁 Tipo: ${r.tipo}${nota ? `\n🎞️ Analizado: ${nota}` : ""}

🚫 *Aviso ${avisos}/${AVISOS_MAX}* — se acabaron las oportunidades.
Vas fuera del grupo.

_SKY NSFW DETECTION_`,
        mentions: [autorJid]
      });

      try {
        await conn.groupParticipantsUpdate(chatId, [autorJid], "remove");
        guardarAvisos(cfg, chatId, autorNum, 0);
      } catch (e) {
        console.error("[antiporno] no pude expulsar:", e.message);

        await conn.sendMessage(chatId, {
          text: "⚠️ No pude expulsarlo: necesito ser administrador del grupo."
        });
      }

      return true;
    }

    await conn.sendMessage(chatId, {
      text:
`🔞 *CONTENIDO +18 ELIMINADO*

👤 Usuario: ${mencion}
📊 Detección: *${r.porcentaje}%* (${r.veredicto})
📁 Tipo: ${r.tipo}${nota ? `\n🎞️ Analizado: ${nota}` : ""}

⚠️ *Aviso ${avisos}/${AVISOS_MAX}* — aquí no se permite este contenido.
Si llegas a *${AVISOS_MAX}* serás eliminado del grupo.

_SKY NSFW DETECTION_`,
      mentions: [autorJid]
    });

    return true;
  } catch (e) {
    console.error("[antiporno] error:", e?.message || e);
    return false;
  }
}

export default { revisarNsfw };
