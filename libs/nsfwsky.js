// libs/nsfwsky.js — Cliente de SKY NSFW DETECTION
// https://nsfwsky.ultraplus.click/api/v1
//
// Sin registro ni API key. Se le manda el archivo y devuelve el porcentaje
// de contenido +18 que detecta el modelo Falconsai/nsfw_image_detection.

"use strict";

export const API_NSFW = "https://nsfwsky.ultraplus.click/api/v1";

const TIMEOUT = 90000;
export const UMBRAL_GORE = 25;   // los autores del detector recomiendan 25, no 70
const REINTENTOS = 3;
const ESPERA_REINTENTO = 3000;

// La IA tarda un poco en arrancar, y si le llegan muchas peticiones seguidas
// corta. En esos dos casos merece la pena reintentar; en el resto, no.
const REINTENTABLES = new Set(["MODEL_NOT_READY", "RATE_LIMITED", "TIMEOUT"]);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizar(data) {
  const percent = Number(data?.percent ?? data?.nsfw_percent ?? 0);
  const gorePercent = Number(data?.gore?.percent ?? 0);

  // checked es la fuente de la verdad: si una categoría no está ahí, su
  // porcentaje viene a 0 y eso NO significa que esté limpia.
  const revisado = Array.isArray(data?.checked) ? data.checked : ["nsfw", "gore"];

  return {
    ...data,
    percent,
    porcentaje: percent.toFixed(2),
    esNsfw: data?.is_nsfw === true || data?.flags?.nsfw === true,
    nivel: data?.level || "",
    veredicto: data?.verdict || "",
    accion: data?.action || "",
    tipo: data?.media?.type || "",
    formato: data?.media?.format || "",
    fotogramas: data?.media?.frames_analyzed ?? null,

    // ---- sangre / gore ----
    esGore: data?.is_gore === true || data?.gore?.detected === true || data?.flags?.gore === true,
    gorePercent,
    gorePorcentaje: gorePercent.toFixed(2),
    goreNivel: data?.gore?.level || "",
    goreZonas: data?.gore?.detections ?? null,
    goreDisponible: data?.gore?.available !== false,

    revisado,
    seRevisoNsfw: revisado.includes("nsfw"),
    seRevisoGore: revisado.includes("gore")
  };
}

// La API acepta ?checks=nsfw, ?checks=gore o las dos. Pidiendo solo lo que el
// grupo tiene activado tarda aproximadamente la mitad.
function construirUrl({ umbral, umbralGore, checks }) {
  const q = new URLSearchParams();

  q.set("threshold", String(umbral));
  q.set("gore_threshold", String(umbralGore));

  if (Array.isArray(checks) && checks.length && checks.length < 2) {
    q.set("checks", checks.join(","));
  }

  return `${API_NSFW}/check?${q.toString()}`;
}

/**
 * Analiza un archivo ya descargado.
 * @param {Buffer} buffer  contenido del archivo
 * @param {object} opciones
 * @param {string} opciones.nombre  nombre con el que se sube (ayuda a la API a saber el formato)
 * @param {number} opciones.umbral  porcentaje a partir del cual se marca como +18
 */
export async function analizarBuffer(buffer, {
  nombre = "media",
  umbral = 70,
  umbralGore = UMBRAL_GORE,
  checks = ["nsfw", "gore"],
  timeout = TIMEOUT
} = {}) {
  if (!buffer?.length) return { ok: false, code: "NO_INPUT", error: "No se recibió ningún archivo." };

  let ultimo = { ok: false, code: "UNKNOWN", error: "No se pudo analizar." };

  for (let intento = 1; intento <= REINTENTOS; intento++) {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), timeout);

    try {
      const form = new FormData();
      form.append("file", new Blob([buffer]), nombre);

      const res = await fetch(construirUrl({ umbral, umbralGore, checks }), {
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
export async function analizarUrl(url, {
  umbral = 70,
  umbralGore = UMBRAL_GORE,
  checks = ["nsfw", "gore"],
  timeout = TIMEOUT
} = {}) {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), timeout);

  try {
    const res = await fetch(construirUrl({ umbral, umbralGore, checks }), {
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
