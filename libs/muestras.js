// libs/muestras.js — Saca fotogramas repartidos de un video, GIF o sticker
// animado para mandarlos a analizar.
//
// La usan el comando .xxx y el antiporno automático (bot principal y subbots),
// para que los tres decidan igual.
//
// Se mandan fotos en vez del archivo porque pesan una fracción, la API no tiene
// que extraer fotogramas por su cuenta (funciona aunque su servidor no tenga
// ffmpeg) y se cubren varios momentos en vez de uno.

"use strict";

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const ejecutar = promisify(execFile);

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export const MAX_CAPTURAS = 5;
const ANCHO = 640;

// Si el archivo no dice cuánto dura y ffprobe tampoco, se prueban estos
// segundos a ciegas: cubren un sticker animado corriente.
const A_CIEGAS = [0.3, 1.2, 2.4];

function borrar(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// ffmpeg no sabe decodificar un WebP animado: su demuxer no soporta la
// animación y devuelve "Invalid data found". Los stickers animados de WhatsApp
// son justo eso, así que esos van por sharp, que sí los lee.
export function esWebpAnimado(buffer) {
  if (!buffer || buffer.length < 16) return false;
  if (buffer.slice(0, 4).toString("latin1") !== "RIFF") return false;
  if (buffer.slice(8, 12).toString("latin1") !== "WEBP") return false;

  // El trozo ANMF marca cada fotograma de la animación.
  return buffer.slice(0, 4096).includes(Buffer.from("ANMF"));
}

// Reparte índices igual que los segundos: sin pegarse al primero ni al último.
function indicesRepartidos(total, cuantas) {
  if (total <= 1) return [0];

  const n = Math.min(cuantas, total);
  const desde = (total - 1) * 0.08;
  const hasta = (total - 1) * 0.92;
  const paso = n > 1 ? (hasta - desde) / (n - 1) : 0;

  const indices = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(desde + paso * i);
    if (!indices.includes(idx)) indices.push(idx);
  }

  return indices;
}

async function capturasDeWebpAnimado(buffer) {
  const sharp = (await import("sharp")).default;

  const meta = await sharp(buffer, { animated: true }).metadata();
  const paginas = Number(meta.pages) || 1;
  if (paginas <= 1) return [];

  // La duración sale de sumar lo que dura cada fotograma.
  const ms = (meta.delay || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const segundos = ms > 0 ? ms / 1000 : paginas / 10;

  const cuantas = puntosDeMuestreo(segundos).length || 2;
  const indices = indicesRepartidos(paginas, cuantas);

  const muestras = [];

  for (let i = 0; i < indices.length; i++) {
    try {
      const jpg = await sharp(buffer, { page: indices[i] })
        .resize({ width: ANCHO, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      if (jpg.length > 1024) {
        muestras.push({
          datos: jpg,
          nombre: `captura_${i + 1}.jpg`,
          nota: `fotograma ${indices[i] + 1} de ${paginas}`
        });
      }
    } catch {}
  }

  return muestras;
}

/**
 * Cuántas fotos y en qué segundos, según lo que dure.
 *
 * Se reparten entre el 8% y el 92% en vez de tomar el principio y el final
 * exactos, porque el primer y el último fotograma suelen ser negros o el
 * logo de turno.
 */
export function puntosDeMuestreo(duracion) {
  const d = Number(duracion) || 0;
  if (d <= 0) return [];

  // Un sticker de menos de un segundo no da para repartir nada.
  if (d < 1) return [Number((d * 0.5).toFixed(2))];

  let cuantas;
  if (d <= 3) cuantas = 2;          // sticker animado corto
  else if (d <= 10) cuantas = 3;    // sticker largo o GIF
  else if (d <= 60) cuantas = 3;    // video de menos de un minuto
  else if (d <= 300) cuantas = 4;   // hasta cinco minutos
  else cuantas = MAX_CAPTURAS;      // películas: cinco repartidas

  const desde = d * 0.08;
  const hasta = d * 0.92;
  const paso = cuantas > 1 ? (hasta - desde) / (cuantas - 1) : 0;

  const puntos = [];
  for (let i = 0; i < cuantas; i++) {
    puntos.push(Number((desde + paso * i).toFixed(2)));
  }

  return puntos;
}

/** Duración en segundos, o 0 si no se puede saber. */
export async function duracionDeArchivo(ruta) {
  try {
    const { stdout } = await ejecutar(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      ruta
    ], { timeout: 20000 });

    const d = Number(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

async function sacarCaptura(entrada, segundo, salida) {
  await ejecutar(FFMPEG, [
    "-y",
    "-ss", String(segundo),   // antes de -i: salta sin descodificar lo anterior
    "-i", entrada,
    "-vframes", "1",
    "-vf", `scale=${ANCHO}:-2`,
    "-q:v", "3",
    "-loglevel", "error",
    salida
  ], { timeout: 30000 });

  const foto = await fs.promises.readFile(salida);
  return foto.length > 1024 ? foto : null;
}

// Un webp animado a veces no admite el salto por tiempo. Ahí se va por número
// de fotograma, que sí funciona con la secuencia completa.
async function capturaPorFotograma(entrada, indice, salida) {
  await ejecutar(FFMPEG, [
    "-y",
    "-i", entrada,
    "-vf", `select=eq(n\\,${indice}),scale=${ANCHO}:-2`,
    "-vframes", "1",
    "-q:v", "3",
    "-loglevel", "error",
    salida
  ], { timeout: 30000 });

  const foto = await fs.promises.readFile(salida);
  return foto.length > 1024 ? foto : null;
}

function etiqueta(segundo) {
  if (segundo < 60) return `segundo ${segundo < 10 ? segundo.toFixed(1) : Math.round(segundo)}`;

  const min = Math.floor(segundo / 60);
  const seg = Math.round(segundo % 60);
  return `minuto ${min}:${String(seg).padStart(2, "0")}`;
}

/**
 * Devuelve las muestras a analizar: [{ datos, nombre, nota }]
 *
 * Para una imagen o un sticker quieto devuelve el archivo tal cual. Para un
 * video, GIF o sticker animado devuelve varias fotos repartidas. Si no se
 * pudiera sacar ninguna, devuelve el archivo original antes que dejarlo sin
 * analizar.
 */
export async function muestrasDeMedia(buffer, { animado = true, duracion = 0, extension = "mp4", nombreOriginal = "" } = {}) {
  const original = [{
    datos: buffer,
    nombre: nombreOriginal || `media.${extension}`,
    nota: "archivo completo"
  }];

  if (!animado) return original;

  // Los stickers animados van por sharp: ffmpeg no puede con ellos.
  if (esWebpAnimado(buffer)) {
    try {
      const porSharp = await capturasDeWebpAnimado(buffer);
      if (porSharp.length) return porSharp;
    } catch (e) {
      console.error("[muestras] sticker animado:", e?.message || e);
    }

    // Si sharp tampoco puede, se manda el sticker entero: la API sabe
    // tratar sticker_animado por su cuenta.
    return original;
  }

  const base = path.join(os.tmpdir(), `mu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const entrada = `${base}_in.${extension}`;
  const temporales = [entrada];

  try {
    await fs.promises.writeFile(entrada, buffer);

    let segundos = Number(duracion) || 0;
    if (!segundos) segundos = await duracionDeArchivo(entrada);

    const puntos = puntosDeMuestreo(segundos);
    const muestras = [];

    // 1) por tiempo, que es lo normal
    for (let i = 0; i < puntos.length; i++) {
      const salida = `${base}_${i}.jpg`;
      temporales.push(salida);

      try {
        const foto = await sacarCaptura(entrada, puntos[i], salida);
        if (foto) {
          muestras.push({
            datos: foto,
            nombre: `captura_${i + 1}.jpg`,
            nota: `captura del ${etiqueta(puntos[i])}`
          });
        }
      } catch {}
    }

    if (muestras.length) return muestras;

    // 2) sin duración conocida: se prueban unos segundos a ciegas
    if (!segundos) {
      for (let i = 0; i < A_CIEGAS.length; i++) {
        const salida = `${base}_c${i}.jpg`;
        temporales.push(salida);

        try {
          const foto = await sacarCaptura(entrada, A_CIEGAS[i], salida);
          if (foto) {
            muestras.push({
              datos: foto,
              nombre: `captura_${i + 1}.jpg`,
              nota: `captura del ${etiqueta(A_CIEGAS[i])}`
            });
          }
        } catch {}
      }

      if (muestras.length) return muestras;
    }

    // 3) por número de fotograma, para los webp animados que no admiten el salto
    for (const indice of [0, 5, 12]) {
      const salida = `${base}_f${indice}.jpg`;
      temporales.push(salida);

      try {
        const foto = await capturaPorFotograma(entrada, indice, salida);
        if (foto) {
          muestras.push({
            datos: foto,
            nombre: `captura_${muestras.length + 1}.jpg`,
            nota: `fotograma ${indice + 1}`
          });
        }
      } catch {}
    }

    // 4) nada salió: se manda el archivo entero antes que quedarse sin analizar
    return muestras.length ? muestras : original;
  } catch (e) {
    console.error("[muestras] no pude preparar el archivo:", e?.message || e);
    return original;
  } finally {
    for (const t of temporales) borrar(t);
  }
}

export default { muestrasDeMedia, puntosDeMuestreo, duracionDeArchivo, MAX_CAPTURAS };
