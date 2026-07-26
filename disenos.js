// disenos.js — Motor de personalización de menús y descargas.
//
// Un solo módulo para el bot principal y para CADA subbot:
//  • El bot principal guarda su personalización en ./personalizacion.json
//  • Cada subbot guarda la suya en subbots/data/<numero>/personalizacion.json
//
// La personalización incluye:
//  • diseno   → 1..7 (de diseno.json)
//  • nombre   → marca que reemplaza a "La Suki Bot" / "Suki Subbots"
//  • media    → imagen o video (gif) global y/o por menú
//
// Los menús no traen texto decorado: entregan su CONTENIDO (secciones e items)
// y aquí se le aplica el diseño elegido. Así los 7 diseños sirven para todos
// los menús y para los comandos de descarga sin duplicar nada.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Rutas ancladas a la carpeta del bot (donde vive este archivo), no al
// directorio de trabajo: así funciona igual sin importar desde dónde se ejecute.
const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DISENO_FILE = path.join(RAIZ, "diseno.json");

export const MENU_KEYS = [
  "menu",
  "menugrupo",
  "menuaudio",
  "menurpg",
  "menufree",
  "allmenu",
  "menuowner",
  "descargas"
];

export const MENU_NOMBRES = {
  menu: "Menú general",
  menugrupo: "Menú de grupos",
  menuaudio: "Menú de audios",
  menurpg: "Menú RPG",
  menufree: "Menú free",
  allmenu: "All menu",
  menuowner: "Menú owner",
  descargas: "Comandos de descarga"
};

// Media de fábrica por menú (la que traía cada uno antes de personalizar).
// tipo "video" se envía como GIF animado.
const MEDIA_FABRICA_MAIN = {
  menu: { url: "https://cdn.russellxz.click/770fe00e.mp4", tipo: "video" },
  menugrupo: { url: "https://cdn.russellxz.click/8eef84e4.mp4", tipo: "video" },
  menuaudio: { url: "https://cdn.russellxz.click/18bf4be2.mp4", tipo: "video" },
  menurpg: { url: "https://cdn.russellxz.click/d744b5bf.jpeg", tipo: "image" },
  menufree: { url: "https://cdn.russellxz.click/bdd4fca0.jpeg", tipo: "image" },
  allmenu: { url: "https://cdn.russellxz.click/40df9bcb.jpeg", tipo: "image" },
  menuowner: { url: "https://cdn.russellxz.click/a0b60c86.mp4", tipo: "video" }
};

const MEDIA_FABRICA_SUB = {
  menurpg: { url: "https://cdn.russellxz.click/d744b5bf.jpeg", tipo: "image" }
};

// Cualquier menú sin entrada propia usa esta
const MEDIA_FABRICA_DEFECTO_MAIN = { url: "https://cdn.russellxz.click/40df9bcb.jpeg", tipo: "image" };
const MEDIA_FABRICA_DEFECTO_SUB = { url: "https://cdn.russellxz.click/c678c800.jpg", tipo: "image" };

export const MARCA_FABRICA_MAIN = "La Suki Bot";
export const MARCA_FABRICA_SUB = "Suki Subbots";

// ------------------------------------------------------------
// Carga de diseño.json (con caché, se recarga si cambia el archivo)
// ------------------------------------------------------------
let cacheDisenos = null;
let cacheMtime = 0;

function cargarDisenos() {
  try {
    const st = fs.statSync(DISENO_FILE);
    if (cacheDisenos && st.mtimeMs === cacheMtime) return cacheDisenos;
    const data = JSON.parse(fs.readFileSync(DISENO_FILE, "utf-8"));
    if (Array.isArray(data?.disenos) && data.disenos.length) {
      cacheDisenos = data.disenos;
      cacheMtime = st.mtimeMs;
    }
  } catch (e) {
    console.error("[disenos] No se pudo leer diseno.json:", e.message);
  }
  return cacheDisenos || [];
}

export function getDisenos() {
  return cargarDisenos();
}

export function getDiseno(id) {
  const lista = cargarDisenos();
  if (!lista.length) return null;
  const n = Number(id);
  return lista.find((d) => Number(d.id) === n) || lista[0];
}

// ------------------------------------------------------------
// Personalización (bot principal o subbot)
// ------------------------------------------------------------
export function esSubbot(conn) {
  return !!(conn && conn.isSubbot);
}

function baseDir(conn) {
  if (esSubbot(conn)) {
    if (conn.subDataDir) return conn.subDataDir;
    const num = String(conn.subbotNumber || "").replace(/[^0-9]/g, "");
    return path.join(RAIZ, "subbots", "data", num);
  }
  return RAIZ;
}

export function persoPath(conn) {
  return path.join(baseDir(conn), "personalizacion.json");
}

export function mediaDir(conn) {
  return path.join(baseDir(conn), "media_menus");
}

const PERSO_VACIA = {
  diseno: null,
  nombre: null,
  mediaGlobal: null,
  medias: {},
  updatedAt: null
};

export function getPerso(conn) {
  try {
    const file = persoPath(conn);
    if (!fs.existsSync(file)) return { ...PERSO_VACIA, medias: {} };
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      diseno: data?.diseno ?? null,
      nombre: typeof data?.nombre === "string" && data.nombre.trim() ? data.nombre.trim() : null,
      mediaGlobal: data?.mediaGlobal || null,
      medias: data && typeof data.medias === "object" && data.medias ? data.medias : {},
      updatedAt: data?.updatedAt ?? null
    };
  } catch {
    return { ...PERSO_VACIA, medias: {} };
  }
}

export function savePerso(conn, perso) {
  try {
    const dir = baseDir(conn);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = persoPath(conn);
    const data = {
      diseno: perso?.diseno ?? null,
      nombre: perso?.nombre ?? null,
      mediaGlobal: perso?.mediaGlobal || null,
      medias: perso?.medias && typeof perso.medias === "object" ? perso.medias : {},
      updatedAt: Date.now()
    };
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error("[disenos] Error guardando personalización:", e.message);
    return false;
  }
}

// Borra TODA la personalización (comando delmenu)
export function borrarPerso(conn) {
  let borrado = false;
  try {
    const file = persoPath(conn);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      borrado = true;
    }
  } catch {}
  try {
    const dir = mediaDir(conn);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      borrado = true;
    }
  } catch {}
  return borrado;
}

export function hayPersonalizacion(conn) {
  const p = getPerso(conn);
  return !!(p.diseno || p.nombre || p.mediaGlobal || Object.keys(p.medias || {}).length);
}

// ------------------------------------------------------------
// Marca (nombre) y media a usar
// ------------------------------------------------------------
export function getMarca(conn) {
  const p = getPerso(conn);
  if (p.nombre) return p.nombre;
  return esSubbot(conn) ? MARCA_FABRICA_SUB : MARCA_FABRICA_MAIN;
}

export function getDisenoActivo(conn) {
  const p = getPerso(conn);
  return getDiseno(p.diseno || 1);
}

// Guarda un buffer como archivo de media y devuelve el registro para el JSON
export function guardarMedia(conn, buffer, tipo, clave) {
  try {
    const dir = mediaDir(conn);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = tipo === "video" ? "mp4" : "jpg";
    const nombre = `${clave}.${ext}`;
    const destino = path.join(dir, nombre);
    // Limpiar una versión previa con otra extensión
    for (const e of ["jpg", "mp4"]) {
      const viejo = path.join(dir, `${clave}.${e}`);
      if (e !== ext && fs.existsSync(viejo)) {
        try { fs.unlinkSync(viejo); } catch {}
      }
    }
    fs.writeFileSync(destino, buffer);
    return { archivo: nombre, tipo: tipo === "video" ? "video" : "image" };
  } catch (e) {
    console.error("[disenos] Error guardando media:", e.message);
    return null;
  }
}

// Devuelve el contenido listo para sendMessage: { image|video, gifPlayback }
export function getMediaMenu(conn, menuKey) {
  const p = getPerso(conn);
  const reg = (p.medias && p.medias[menuKey]) || p.mediaGlobal || null;

  if (reg && reg.archivo) {
    try {
      const file = path.join(mediaDir(conn), reg.archivo);
      if (fs.existsSync(file)) {
        const buffer = fs.readFileSync(file);
        if (reg.tipo === "video") {
          return { video: buffer, gifPlayback: true };
        }
        return { image: buffer };
      }
    } catch (e) {
      console.error("[disenos] Error leyendo media:", e.message);
    }
  }

  // Media de fábrica del menú
  const sub = esSubbot(conn);
  const tabla = sub ? MEDIA_FABRICA_SUB : MEDIA_FABRICA_MAIN;
  const fab =
    tabla[menuKey] || (sub ? MEDIA_FABRICA_DEFECTO_SUB : MEDIA_FABRICA_DEFECTO_MAIN);

  if (fab.tipo === "video") {
    return { video: { url: fab.url }, gifPlayback: true };
  }
  return { image: { url: fab.url } };
}

// ------------------------------------------------------------
// Renderizado
// ------------------------------------------------------------
function aplicar(plantilla, vars) {
  let out = String(plantilla ?? "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.split(`{${k}}`).join(String(v ?? ""));
  }
  return out;
}

function bloque(lineas, vars) {
  if (!lineas) return [];
  const arr = Array.isArray(lineas) ? lineas : [lineas];
  return arr.map((l) => aplicar(l, vars)).filter((l) => l !== "");
}

/**
 * Renderiza un menú con el diseño activo.
 * contenido = {
 *   titulo: "MENÚ GENERAL",
 *   info:   [["Prefijo", "."], ["Comandos", 230]],   (opcional)
 *   secciones: [{ titulo: "INFORMACIÓN", items: [".ping", ".info"] }],
 *   nota: "texto libre final"                        (opcional)
 * }
 */
export function renderMenu(conn, contenido = {}) {
  const d = getDisenoActivo(conn);
  const marca = getMarca(conn);
  const out = [];

  if (!d) {
    // Sin diseño disponible: salida simple para no romper nada
    out.push(`*${marca}*`, "", `*${contenido.titulo || ""}*`);
    for (const s of contenido.secciones || []) {
      out.push("", `*${s.titulo}*`);
      for (const it of s.items || []) out.push(`• ${it}`);
    }
    if (contenido.nota) out.push("", contenido.nota);
    return out.join("\n").trim();
  }

  out.push(...bloque(d.cabecera, { marca }));

  if (contenido.titulo) {
    out.push("");
    out.push(aplicar(d.titulo, { titulo: contenido.titulo, marca }));
  }

  const info = Array.isArray(contenido.info) ? contenido.info : [];
  if (info.length) {
    out.push("");
    for (const [clave, valor] of info) {
      out.push(aplicar(d.info, { clave, valor, marca }));
    }
  }

  for (const sec of contenido.secciones || []) {
    const items = (sec?.items || []).filter(Boolean);
    if (!items.length) continue;
    out.push("");
    const abre = aplicar(d.seccionAbre, { seccion: sec.titulo || "", marca });
    if (abre) out.push(abre);
    for (const it of items) out.push(aplicar(d.seccionItem, { item: it, marca }));
    const cierra = aplicar(d.seccionCierra, { seccion: sec.titulo || "", marca });
    if (cierra) out.push(cierra);
  }

  if (contenido.nota) {
    out.push("");
    out.push(aplicar(d.nota, { texto: contenido.nota, marca }));
  }

  const pie = bloque(d.pie, { marca });
  if (pie.length) {
    out.push("");
    out.push(...pie);
  }

  return out.join("\n").trim();
}

/**
 * Renderiza la ficha de un comando de descarga con el diseño activo.
 * contenido = {
 *   titulo: "AUDIO DESCARGADO",
 *   campos: [["Título", "..."], ["Autor", "..."]],
 *   nota: "texto final"  (opcional)
 * }
 */
export function renderDescarga(conn, contenido = {}) {
  const d = getDisenoActivo(conn);
  const marca = getMarca(conn);
  const dd = d?.descarga;
  const out = [];

  if (!dd) {
    out.push(`*${contenido.titulo || ""}*`, "");
    for (const [clave, valor] of contenido.campos || []) out.push(`${clave}: *${valor}*`);
    if (contenido.nota) out.push("", contenido.nota);
    out.push("", `_${marca}_`);
    return out.join("\n").trim();
  }

  out.push(...bloque(dd.cabecera, { titulo: contenido.titulo || "", marca }));

  const campos = Array.isArray(contenido.campos) ? contenido.campos : [];
  if (campos.length) {
    out.push("");
    for (const [clave, valor] of campos) {
      if (valor === undefined || valor === null || valor === "") continue;
      out.push(aplicar(dd.campo, { clave, valor, marca }));
    }
  }

  if (contenido.nota) {
    out.push("");
    out.push(contenido.nota);
  }

  const pie = bloque(dd.pie, { marca });
  if (pie.length) {
    out.push("");
    out.push(...pie);
  }

  return out.join("\n").trim();
}

/**
 * Envía un menú ya renderizado con su imagen/video correspondiente.
 * Si la media falla, cae a texto para no dejar al usuario sin respuesta.
 */
export async function enviarMenu(conn, chatId, msg, menuKey, contenido) {
  const caption = renderMenu(conn, contenido);
  const media = getMediaMenu(conn, menuKey);

  // El bot principal usa sendMessage2 (adjunta su canal); los subbots no lo tienen
  const enviar = (contenido2) =>
    typeof conn.sendMessage2 === "function"
      ? conn.sendMessage2(chatId, contenido2, msg)
      : conn.sendMessage(chatId, contenido2, { quoted: msg });

  try {
    return await enviar({ ...media, caption });
  } catch (e) {
    console.error(`[disenos] Media de ${menuKey} falló, enviando texto:`, e.message);
    try {
      return await enviar({ text: caption });
    } catch {}
  }
}

/** Cabecera con el diseño activo, para las fichas de los comandos de descarga */
export function cabeceraDescarga(conn, titulo = "") {
  const d = getDisenoActivo(conn);
  const marca = getMarca(conn);
  const dd = d?.descarga;
  if (!dd) return `*${titulo || marca}*`;
  return bloque(dd.cabecera, { titulo: titulo || marca, marca }).join("\n");
}

/** Pie con el diseño activo y el nombre personalizado */
export function pieDescarga(conn) {
  const d = getDisenoActivo(conn);
  const marca = getMarca(conn);
  const dd = d?.descarga;
  if (!dd) return `_${marca}_`;
  return bloque(dd.pie, { marca, titulo: marca }).join("\n");
}

// Lista de diseños para mostrar en el selector de setmenu
export function listaDisenosTexto() {
  return getDisenos()
    .map((d) => `*${d.id}.* ${d.emoji || ""} ${d.nombre} — _${d.descripcion || ""}_`)
    .join("\n");
}
