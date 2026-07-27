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
// Canal oficial: es lo que hace salir el botón "Ver canal" debajo
// del mensaje. El bot principal ya lo pone con sendMessage2; con esto
// los subbots y los comandos de descarga también lo llevan.
// ------------------------------------------------------------
export const CANAL = {
  id: "120363266665814365@newsletter",
  nombre: "👑 LA SUKI BOT 👑"
};

/**
 * Limpia el mensaje que genera el TELÉFONO del usuario al tocar un botón.
 *
 * Al pulsar un botón nativo, quien lo toca envía un `interactiveResponseMessage`.
 * Los WhatsApp que no saben mostrar ese tipo lo pintan como "Recibiste un
 * mensaje que no es compatible con tu versión de WhatsApp": el que tocó lo ve
 * bien, los demás del grupo ven ese aviso. El bot no puede cambiar lo que emite
 * un teléfono ajeno, pero sí puede borrar ese mensaje del chat.
 *
 * Solo se hace en grupos (en privado no lo ve nadie más) y requiere que el bot
 * sea admin para borrar mensajes de otros; si no puede, falla en silencio y
 * todo lo demás sigue funcionando igual.
 */
export function limpiarRespuestaBoton(conn, m) {
  try {
    if (!m?.message?.interactiveResponseMessage) return;
    const chatId = m.key?.remoteJid || "";
    if (!chatId.endsWith("@g.us")) return;
    // Pequeña espera: primero que el comando haga su trabajo
    setTimeout(() => {
      conn.sendMessage(chatId, { delete: m.key }).catch(() => {});
    }, 1200);
  } catch {}
}

/** contextInfo con el canal (botón "Ver canal"), conservando lo que ya hubiera */
export function canal(extra = {}) {
  return {
    ...extra,
    forwardedNewsletterMessageInfo: {
      newsletterJid: CANAL.id,
      serverMessageId: "",
      newsletterName: CANAL.nombre
    },
    forwardingScore: 9999999,
    isForwarded: true
  };
}

// ------------------------------------------------------------
// Listas desplegables de WhatsApp (nativeFlow "single_select")
// ------------------------------------------------------------
// WhatsApp impone límites duros a las listas. Si el payload se pasa, el
// cliente DIBUJA el botón pero al tocarlo no abre nada: falla al interpretar
// la lista y se queda callado. Los clientes viejos son permisivos y los
// nuevos no, por eso el típico "a mí me funciona pero a otros no".
export const LIMITES_LISTA = {
  filas: 10,          // filas TOTALES sumando todas las secciones
  secciones: 10,
  boton: 24,
  tituloSeccion: 24,
  tituloFila: 24,
  descripcion: 72
};

// Corta contando caracteres visibles (un emoji cuenta 1, no 2 ni 4)
const segmentador =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("es", { granularity: "grapheme" })
    : null;

export function cortarTexto(texto, max) {
  const s = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (!segmentador) return s.length <= max ? s : s.slice(0, max);
  const letras = [...segmentador.segment(s)].map((g) => g.segment);
  if (letras.length <= max) return s;
  return letras.slice(0, Math.max(1, max - 1)).join("").trimEnd() + "…";
}

/**
 * Deja una lista dentro de lo que WhatsApp acepta: recorta títulos y
 * descripciones, quita filas sin id o repetidas, limita el total de filas y
 * descarta secciones que quedaron vacías.
 *
 * Devuelve `null` si no queda ninguna fila utilizable, para que quien llama
 * pueda enviar la versión de texto en vez de un botón que no abre nada.
 *
 * `opciones.filas` sube o baja el tope de filas para una lista concreta
 * (setmenu enseña sus diseños completos y necesita más de 10).
 */
export function listaSegura(botones, opciones = {}) {
  if (!Array.isArray(botones) || !botones.length) return null;

  const topeFilas = Number(opciones.filas) > 0 ? Number(opciones.filas) : LIMITES_LISTA.filas;
  const salida = [];

  for (const boton of botones) {
    // Botones que no son lista (copiar, url, etc.) pasan tal cual
    if (!Array.isArray(boton?.sections)) {
      salida.push(boton);
      continue;
    }

    const idsVistos = new Set();
    let filasLibres = topeFilas;
    const secciones = [];

    for (const seccion of boton.sections) {
      if (secciones.length >= LIMITES_LISTA.secciones || filasLibres <= 0) break;

      const filas = [];
      for (const fila of seccion?.rows || []) {
        if (filasLibres <= 0) break;

        const id = String(fila?.id ?? fila?.rowId ?? "").trim();
        if (!id || idsVistos.has(id)) continue;   // sin id no se puede responder

        const titulo = cortarTexto(fila?.title, LIMITES_LISTA.tituloFila);
        if (!titulo) continue;

        idsVistos.add(id);
        filas.push({
          header: typeof fila?.header === "string" ? fila.header : "",
          title: titulo,
          description: cortarTexto(fila?.description, LIMITES_LISTA.descripcion),
          id
        });
        filasLibres--;
      }

      if (!filas.length) continue;

      const nueva = {
        title: cortarTexto(seccion?.title, LIMITES_LISTA.tituloSeccion),
        rows: filas
      };
      const etiqueta = cortarTexto(seccion?.highlight_label, LIMITES_LISTA.tituloSeccion);
      if (etiqueta) nueva.highlight_label = etiqueta;
      secciones.push(nueva);
    }

    if (!secciones.length) continue;

    salida.push({
      text: cortarTexto(boton?.text, LIMITES_LISTA.boton) || "Ver opciones",
      sections: secciones
    });
  }

  return salida.length ? salida : null;
}

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
// ------------------------------------------------------------
// Fuentes: un diseño puede pedir que los TÍTULOS salgan con otro tipo de
// letra. Solo se aplica a títulos y nombres de sección, nunca a los
// comandos (esos tienen que poder copiarse y escribirse tal cual).
// ------------------------------------------------------------
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const abc = "abcdefghijklmnopqrstuvwxyz";
const NUM = "0123456789";

const FUENTES = {
  negrita: {
    A: "𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭",
    a: "𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇",
    n: "𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵"
  },
  cursiva: {
    A: "𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡",
    a: "𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻",
    n: NUM
  },
  doble: {
    A: "𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ",
    a: "𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫",
    n: "𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡"
  },
  mono: {
    A: "𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉",
    a: "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣",
    n: "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿"
  },
  ancha: {
    A: "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ",
    a: "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
    n: "０１２３４５６７８９"
  },
  pequena: {
    A: "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ",
    a: "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ",
    n: NUM
  },
  gotica: {
    A: "𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ",
    a: "𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷",
    n: NUM
  }
};

// Convierte un texto a la fuente pedida (deja intactos emojis y símbolos)
export function aFuente(texto, fuente) {
  const f = FUENTES[fuente];
  if (!f) return String(texto ?? "");
  const may = [...f.A];
  const min = [...f.a];
  const dig = [...f.n];
  let out = "";
  for (const ch of String(texto ?? "")) {
    const iA = ABC.indexOf(ch);
    if (iA >= 0) { out += may[iA] ?? ch; continue; }
    const ia = abc.indexOf(ch);
    if (ia >= 0) { out += min[ia] ?? ch; continue; }
    const iN = NUM.indexOf(ch);
    if (iN >= 0) { out += dig[iN] ?? ch; continue; }
    out += ch;
  }
  return out;
}

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
    out.push(aplicar(d.titulo, { titulo: aFuente(contenido.titulo, d.fuente), marca }));
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
    const abre = aplicar(d.seccionAbre, { seccion: aFuente(sec.titulo || "", d.fuente), marca });
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

  out.push(...bloque(dd.cabecera, { titulo: aFuente(contenido.titulo || "", d.fuente), marca }));

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

  // El bot principal usa sendMessage2 (ya adjunta el canal); los subbots no lo
  // tienen, así que aquí se les pone el contextInfo del canal para que también
  // les salga el botón "Ver canal".
  // Se adjunta SIEMPRE el canal aquí (no se confía en que lo haga quien
  // envía): así sale el botón "Ver canal" tanto en el bot principal como
  // en los subbots, con o sin personalización.
  const enviar = (contenido2) => {
    const conCanal = { ...contenido2, contextInfo: canal(contenido2.contextInfo) };
    return typeof conn.sendMessage2 === "function"
      ? conn.sendMessage2(chatId, conCanal, msg)
      : conn.sendMessage(chatId, conCanal, { quoted: msg });
  };

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
  return bloque(dd.cabecera, { titulo: aFuente(titulo || marca, d.fuente), marca }).join("\n");
}

/** Lista de campos (clave/valor) con el estilo del diseño activo */
export function camposDescarga(conn, campos = []) {
  const d = getDisenoActivo(conn);
  const marca = getMarca(conn);
  const plantilla = d?.descarga?.campo || "{clave}: *{valor}*";
  return (campos || [])
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([clave, valor]) => aplicar(plantilla, { clave, valor, marca }))
    .join("\n");
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
