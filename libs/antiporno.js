// libs/antiporno.js — Moderación automática de contenido +18 y sangre.
//
// Dos filtros independientes que se activan por separado en cada grupo:
//   .antiporno on  → borra desnudos y contenido sexual
//   .antigore  on  → borra sangre y escenas gráficas
//
// Se llama por cada mensaje que llega. Si el grupo no tiene ninguno de los dos
// activado no hace absolutamente nada, ni una petición: así el bot no delata
// que está mirando ni gasta la API. Y si solo tiene uno, a la API se le pide
// solo esa categoría, que tarda la mitad.
//
// Cuando hay motivo para borrar: borra el mensaje, avisa con el contador, y a
// la quinta infracción expulsa a quien la mandó. El contador es común a los
// dos filtros: cinco avisos y fuera, sea por lo que sea.

"use strict";

import { setConfig, getConfig } from "../db.js";
import { analizarBuffer, UMBRAL_GORE } from "./nsfwsky.js";
import { muestrasDeMedia } from "./muestras.js";

const UMBRAL = 85;          // % a partir del cual se considera +18
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
 * Revisa un mensaje y actúa según lo que el grupo tenga activado.
 *
 * antiporno on  → borra el contenido +18
 * antigore  on  → borra la sangre / gore
 * los dos on    → borra cualquiera de las dos
 * ninguno       → no hace nada, ni una petición a la API
 *
 * Las dos comparten el mismo contador de avisos: cinco infracciones y fuera,
 * sea por lo que sea.
 *
 * @returns {Promise<boolean>} true si borró el mensaje.
 */
export async function revisarNsfw(conn, m, { owners = [] } = {}) {
  try {
    const chatId = m?.key?.remoteJid;

    if (!chatId || !chatId.endsWith("@g.us")) return false;   // solo grupos
    if (m.key.fromMe) return false;                            // nunca al propio bot

    const cfg = configDe(conn);

    // Qué modera este grupo. Si no hay nada activado, ni se mira el mensaje.
    const moderar = {
      nsfw: Number(cfg.leer(chatId, "antiporno")) === 1,
      gore: Number(cfg.leer(chatId, "antigore")) === 1
    };

    if (!moderar.nsfw && !moderar.gore) return false;

    const media = multimediaDe(m.message);
    if (!media) return false;

    // Los dueños del bot se saltan el filtro.
    const autorJid = m.realJid || m.key.participant || chatId;
    const autorNum = DIGITS(String(m.realNumber || autorJid).split(":")[0]);

    if (owners.some((o) => DIGITS(Array.isArray(o) ? o[0] : o) === autorNum)) return false;

    // Solo se descarta lo desmesurado, para no cargarlo entero en memoria.
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

    // A la API solo se le pide lo que este grupo modera: pidiendo una sola
    // categoría tarda aproximadamente la mitad.
    const checks = [];
    if (moderar.nsfw) checks.push("nsfw");
    if (moderar.gore) checks.push("gore");

    // De cada categoría se guarda el peor valor de todas las muestras, igual
    // que hace la API con los fotogramas de un video.
    let peorNsfw = null;
    let peorGore = null;
    let notaNsfw = "";
    let notaGore = "";
    let fallo = null;
    let tipoMedia = media.tipo;
    let vistas = 0;

    for (const muestra of muestras) {
      if (muestra.datos.length > MAX_MB * 1024 * 1024) {
        console.log(`[antiporno] muestra descartada: ${(muestra.datos.length / 1024 / 1024).toFixed(1)} MB pasa el límite de la API`);
        continue;
      }

      const r = await analizarBuffer(muestra.datos, {
        nombre: muestra.nombre,
        umbral: UMBRAL,
        umbralGore: UMBRAL_GORE,
        checks
      });

      if (!r.ok) {
        fallo = r;
        continue;
      }

      vistas++;
      if (r.tipo) tipoMedia = r.tipo;

      if (moderar.nsfw && r.seRevisoNsfw && (!peorNsfw || r.percent > peorNsfw.percent)) {
        peorNsfw = r;
        notaNsfw = muestra.nota;
      }

      if (moderar.gore && r.seRevisoGore && (!peorGore || r.gorePercent > peorGore.gorePercent)) {
        peorGore = r;
        notaGore = muestra.nota;
      }

      // Ya hay motivo para borrar: no hace falta gastar más peticiones.
      if ((moderar.nsfw && r.esNsfw) || (moderar.gore && r.esGore)) break;

      // Tres muestras seguidas muy limpias: el resto no va a cambiar nada.
      if (
        vistas >= 3 &&
        (!peorNsfw || peorNsfw.percent < 20) &&
        (!peorGore || peorGore.gorePercent < 10)
      ) break;
    }

    // Si la API falla NO borramos: mejor dejar pasar algo dudoso que cargarse
    // una foto normal porque el servidor estaba caído.
    if (!peorNsfw && !peorGore) {
      if (fallo) console.error("[antiporno]", fallo.code, fallo.error);
      return false;
    }

    const resumenNsfw = moderar.nsfw && peorNsfw ? `+18 ${peorNsfw.porcentaje}%` : "+18 no revisado";
    const resumenGore = moderar.gore && peorGore ? `sangre ${peorGore.gorePorcentaje}%` : "sangre no revisada";
    console.log(`[antiporno] ${chatId} · ${tipoMedia} · ${resumenNsfw} · ${resumenGore} · ${vistas} muestra(s)`);

    // Solo cuentan las categorías que este grupo tiene encendidas.
    const motivos = [];
    let nota = "";

    if (moderar.nsfw && peorNsfw?.esNsfw) {
      motivos.push(`🔞 Contenido +18 *${peorNsfw.porcentaje}%*`);
      nota = notaNsfw;
    }

    if (moderar.gore && peorGore?.esGore) {
      motivos.push(`🩸 Sangre / gore *${peorGore.gorePorcentaje}%*`);
      nota = nota || notaGore;
    }

    if (!motivos.length) return false;

    // ---- borrar ----
    try {
      await conn.sendMessage(chatId, { delete: m.key });
    } catch (e) {
      console.error("[antiporno] no pude borrar (¿el bot no es admin?):", e.message);

      await conn.sendMessage(chatId, {
        text: `🚫 *Contenido no permitido detectado*\n${motivos.join("\n")}\n\n⚠️ No puedo borrarlo porque no soy administrador del grupo.`
      });

      return false;
    }

    // ---- avisar y contar ----
    const avisos = avisosDe(cfg, chatId, autorNum) + 1;
    guardarAvisos(cfg, chatId, autorNum, avisos);

    const mencion = `@${autorNum}`;
    const detalle = [
      `👤 Usuario: ${mencion}`,
      `📊 Motivo: ${motivos.join(" y ")}`,
      `📁 Tipo: ${tipoMedia}`,
      nota ? `🎞️ Analizado: ${nota}` : ""
    ].filter(Boolean).join("\n");

    if (avisos >= AVISOS_MAX) {
      await conn.sendMessage(chatId, {
        text:
`🚫 *CONTENIDO ELIMINADO*

${detalle}

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
`🚫 *CONTENIDO ELIMINADO*

${detalle}

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
