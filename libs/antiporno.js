// libs/antiporno.js — Moderación automática de contenido +18 en grupos.
//
// Se llama por cada mensaje que llega. Si el grupo no tiene el antiporno
// activado no hace absolutamente nada, ni una petición: así el bot no delata
// que está mirando ni gasta la API.
//
// Cuando detecta contenido +18: borra el mensaje, avisa con el contador de
// avisos, y a la quinta vez expulsa a quien lo mandó.

"use strict";

import { setConfig, getConfig } from "../db.js";
import { analizarBuffer } from "./nsfwsky.js";
import { muestrasDeMedia } from "./muestras.js";

const UMBRAL = 70;          // % a partir del cual se considera +18
const AVISOS_MAX = 5;       // al quinto, fuera del grupo
const MAX_MB = 25;          // límite que acepta la API
const MAX_MB_DESCARGA = 120; // por encima de esto ni lo bajamos, para no reventar la RAM

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

  if (raiz.imageMessage) return { tipo: "image", nodo: raiz.imageMessage, nombre: "media.jpg", extension: "jpg", animado: false };
  if (raiz.stickerMessage) {
    return {
      tipo: "sticker",
      nodo: raiz.stickerMessage,
      nombre: "media.webp",
      extension: "webp",
      // Un sticker animado se mira fotograma a fotograma; uno quieto va tal cual.
      animado: !!raiz.stickerMessage.isAnimated
    };
  }

  if (raiz.videoMessage) {
    // Los GIF de WhatsApp son vídeos con gifPlayback.
    const nombre = raiz.videoMessage.gifPlayback ? "media.gif.mp4" : "media.mp4";
    return {
      tipo: "video",
      nodo: raiz.videoMessage,
      nombre,
      extension: "mp4",
      animado: true,
      duracion: Number(raiz.videoMessage.seconds || 0)
    };
  }

  if (raiz.documentMessage && /^(image|video)\//i.test(raiz.documentMessage.mimetype || "")) {
    const esVideo = /^video\//i.test(raiz.documentMessage.mimetype || "");
    return {
      tipo: "document",
      nodo: raiz.documentMessage,
      nombre: raiz.documentMessage.fileName || "media",
      extension: esVideo ? "mp4" : "jpg",
      animado: esVideo
    };
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

    // De un video o un sticker animado se sacan varias fotos repartidas; una
    // imagen o un sticker quieto van tal cual.
    const muestras = await muestrasDeMedia(buffer, {
      animado: media.animado,
      duracion: media.duracion || 0,
      extension: media.extension || "mp4",
      nombreOriginal: media.nombre
    });

    // Se mira cada muestra y vale la peor, igual que hace la API con los
    // fotogramas de un video. En cuanto una da +18 paramos: ya está decidido
    // y no hace falta gastar otra petición.
    let r = null;
    let nota = "";
    let fallo = null;
    let vistas = 0;

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

      vistas++;

      if (parcial.esNsfw) break;

      // Si las tres primeras salen claramente limpias, el resto no va a
      // cambiar nada: no gastamos más peticiones.
      if (vistas >= 3 && r.percent < 20) break;
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
