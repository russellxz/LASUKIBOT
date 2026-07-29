// libs/nsfwsky.js — Cliente de SKY NSFW DETECTION
// https://nsfwsky.ultraplus.click/api/v1
//
// Sin registro ni API key. Se le manda el archivo y devuelve el porcentaje
// de contenido +18 que detecta el modelo Falconsai/nsfw_image_detection.

"use strict";

export const API_NSFW = "https://nsfwsky.ultraplus.click/api/v1";

const TIMEOUT = 90000;
const REINTENTOS = 3;
const ESPERA_REINTENTO = 3000;

// La IA tarda un poco en arrancar, y si le llegan muchas peticiones seguidas
// corta. En esos dos casos merece la pena reintentar; en el resto, no.
const REINTENTABLES = new Set(["MODEL_NOT_READY", "RATE_LIMITED", "TIMEOUT"]);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizar(data) {
  const percent = Number(data?.percent ?? data?.nsfw_percent ?? 0);

  return {
    ...data,
    percent,
    porcentaje: percent.toFixed(2),
    esNsfw: data?.is_nsfw === true,
    nivel: data?.level || "",
    veredicto: data?.verdict || "",
    accion: data?.action || "",
    tipo: data?.media?.type || "",
    formato: data?.media?.format || "",
    fotogramas: data?.media?.frames_analyzed ?? null
  };
}

/**
 * Analiza un archivo ya descargado.
 * @param {Buffer} buffer  contenido del archivo
 * @param {object} opciones
 * @param {string} opciones.nombre  nombre con el que se sube (ayuda a la API a saber el formato)
 * @param {number} opciones.umbral  porcentaje a partir del cual se marca como +18
 */
export async function analizarBuffer(buffer, { nombre = "media", umbral = 70, timeout = TIMEOUT } = {}) {
  if (!buffer?.length) return { ok: false, code: "NO_INPUT", error: "No se recibió ningún archivo." };

  let ultimo = { ok: false, code: "UNKNOWN", error: "No se pudo analizar." };

  for (let intento = 1; intento <= REINTENTOS; intento++) {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), timeout);

    try {
      const form = new FormData();
      form.append("file", new Blob([buffer]), nombre);

      const res = await fetch(`${API_NSFW}/check?threshold=${encodeURIComponent(umbral)}`, {
        method: "POST",
        body: form,
        signal: control.signal
      });

      const data = await res.json().catch(() => null);

      if (!data) {
        ultimo = { ok: false, code: "BAD_RESPONSE", error: `La API respondió HTTP ${res.status} sin JSON.` };
      } else if (data.ok) {
        return normalizar(data);
      } else {
        ultimo = data;
      }

      if (!REINTENTABLES.has(String(ultimo.code || ""))) return ultimo;
    } catch (e) {
      ultimo = {
        ok: false,
        code: e.name === "AbortError" ? "TIMEOUT" : "NETWORK",
        error: e.name === "AbortError" ? "El análisis tardó demasiado." : e.message
      };

      if (ultimo.code === "NETWORK") return ultimo;
    } finally {
      clearTimeout(corte);
    }

    if (intento < REINTENTOS) await dormir(ESPERA_REINTENTO);
  }

  return ultimo;
}

/** Analiza una imagen que ya está publicada en internet. */
export async function analizarUrl(url, { umbral = 70, timeout = TIMEOUT } = {}) {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), timeout);

  try {
    const res = await fetch(`${API_NSFW}/check?threshold=${encodeURIComponent(umbral)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: control.signal
    });

    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, code: "BAD_RESPONSE", error: `La API respondió HTTP ${res.status}.` };

    return data.ok ? normalizar(data) : data;
  } catch (e) {
    return {
      ok: false,
      code: e.name === "AbortError" ? "TIMEOUT" : "NETWORK",
      error: e.message
    };
  } finally {
    clearTimeout(corte);
  }
}

/** Comprueba si el modelo está despierto. */
export async function estadoApi() {
  try {
    const res = await fetch(`${API_NSFW}/health`, { signal: AbortSignal.timeout(15000) });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default { analizarBuffer, analizarUrl, estadoApi, API_NSFW };
