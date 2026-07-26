// setmenu-core.js — Núcleo del sistema de personalización (setmenu / delmenu).
//
// Lo usan tanto el bot principal (solo owners) como CADA subbot (solo su
// propio número), llamando a abrirSetmenu() / abrirDelmenu() después de
// comprobar los permisos.
//
// Flujo de setmenu: se abre un menú con botones (como el de play) con:
//   • los 7 diseños
//   • imagen/video para TODOS los menús o para uno específico
//   • nombre del bot (marca que sale en menús y descargas)
//   • foto de perfil
//   • ver la personalización actual
// Si el usuario está en iPhone (donde no salen los botones) recibe el mismo
// menú en texto y responde con el número de la opción.

import {
  getDisenos,
  getDiseno,
  getPerso,
  savePerso,
  borrarPerso,
  getMarca,
  guardarMedia,
  hayPersonalizacion,
  esSubbot,
  MENU_KEYS,
  MENU_NOMBRES,
  MARCA_FABRICA_MAIN,
  MARCA_FABRICA_SUB
} from "./disenos.js";

// Menús que se pueden personalizar de a uno (sin "descargas", que sigue al global)
const MENUS_ELEGIBLES = MENU_KEYS.filter((k) => k !== "descargas");

const MAX_MEDIA_MB = 20;
const ESPERA_MS = 5 * 60 * 1000; // 5 minutos para completar un paso

// ------------------------------------------------------------
// Estado pendiente (compartido por todos los subbots del proceso,
// separado por dueño + chat + usuario)
// ------------------------------------------------------------
const pendientes = new Map();

const dueno = (conn) => String(conn?.subbotNumber || conn?.user?.id || "main");
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function claveUsuario(conn, msg) {
  const chatId = msg.key.remoteJid;
  const quien = msg.key.fromMe
    ? DIGITS(conn?.user?.id)
    : DIGITS(msg.key.participant || msg.key.remoteJid);
  return `${dueno(conn)}|${chatId}|${quien}`;
}

function setPendiente(conn, msg, datos) {
  limpiarViejos();
  pendientes.set(claveUsuario(conn, msg), { ...datos, ts: Date.now() });
}

function getPendiente(conn, msg) {
  const k = claveUsuario(conn, msg);
  const p = pendientes.get(k);
  if (!p) return null;
  if (Date.now() - p.ts > ESPERA_MS) {
    pendientes.delete(k);
    return null;
  }
  return p;
}

function borrarPendiente(conn, msg) {
  pendientes.delete(claveUsuario(conn, msg));
}

function limpiarViejos() {
  const ahora = Date.now();
  for (const [k, v] of pendientes.entries()) {
    if (ahora - v.ts > ESPERA_MS) pendientes.delete(k);
  }
}

// ------------------------------------------------------------
// Utilidades de mensajes
// ------------------------------------------------------------

// Los mensajes de iPhone tienen ID "3A" + 18 caracteres: ahí no salen botones
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));

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

function textoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return String(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      ""
  ).trim();
}

// Busca imagen/video en el mensaje o en el mensaje citado
function mediaDe(msg) {
  const m = desenvolver(msg?.message) || {};
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null;
  const citado = ctx?.quotedMessage ? desenvolver(ctx.quotedMessage) : null;

  const img = m.imageMessage || citado?.imageMessage;
  if (img) return { nodo: img, tipo: "image" };

  const vid = m.videoMessage || citado?.videoMessage;
  if (vid) return { nodo: vid, tipo: "video" };

  return null;
}

async function descargar(conn, nodo, tipo) {
  const dl =
    conn?.wa?.downloadContentFromMessage ||
    global?.wa?.downloadContentFromMessage ||
    null;
  if (!dl) throw new Error("No se pudo acceder al descargador de medios.");

  const stream = await dl(nodo, tipo);
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

// ⚠️ En los subbots el dueño escribe desde su MISMO número, así que sus
// mensajes llegan con fromMe = true... igual que los que manda el propio bot.
// Para no confundirlos (el bot se respondía a sí mismo y guardaba su propio
// texto como nombre), guardamos los IDs de todo lo que enviamos y los saltamos.
// ⚠️ Un set POR BOT: todos los subbots y el bot principal comparten este
// módulo, así que si fuera uno solo cada bot creería que los mensajes de
// los demás son suyos (y atendería menús ajenos).
const idsPropios = new Map(); // dueño -> Set de ids enviados

function recordarPropio(conn, res) {
  const id = res?.key?.id;
  if (!id) return res;
  const k = dueno(conn);
  let set = idsPropios.get(k);
  if (!set) {
    set = new Set();
    idsPropios.set(k, set);
  }
  set.add(id);
  if (set.size > 400) {
    // Mantener el set acotado: borrar los más viejos
    const it = set.values();
    for (let i = 0; i < 200; i++) set.delete(it.next().value);
  }
  return res;
}

// ¿Este mensaje lo envió ESTE bot?
function esIdPropio(conn, id) {
  const set = idsPropios.get(dueno(conn));
  return !!(id && set && set.has(id));
}

// Textos con los que empiezan nuestros propios avisos: segunda barrera por si
// el eco llega sin ID (o lo reenvía otro dispositivo vinculado).
const MARCAS_PROPIAS = [
  "🎨 *PERSONALIZACIÓN",
  "🖼️ *Envía ahora",
  "🎯 *¿A qué menú",
  "✏️ *Escribe el nombre",
  "📸 *Envía ahora",
  "👀 *TU PERSONALIZACIÓN",
  "⚠️ *¿SEGURO",
  "✅ *Diseño aplicado",
  "✅ *Media guardada",
  "✅ *Nombre guardado",
  "✅ *Foto de perfil",
  "✅ *Personalización borrada",
  "🚪 Personalización cancelada",
  "🚪 Cancelado.",
  "⚠️ Eso no es una imagen",
  "⚠️ Escribe un nombre válido",
  "⚠️ Número inválido",
  "⚠️ Envía una *imagen*",
  "❌ No se pudo",
  "❌ El archivo pesa",
  "❌ La media llegó",
  "❌ Ese diseño no existe",
  "ℹ️ No tienes ninguna personalización",
  "ℹ️ No había nada que borrar"
];

const esTextoPropio = (t) =>
  MARCAS_PROPIAS.some((m) => String(t || "").startsWith(m));

// ID del mensaje al que responde/cita este mensaje. Sirve para saber si el
// usuario tocó NUESTRO menú o el de otro bot: en un grupo donde están el bot
// principal y varios subbots, todos ven la misma selección y antes todos
// respondían a la vez.
function idCitado(m) {
  const msg = desenvolver(m?.message) || {};
  const ctx =
    msg.listResponseMessage?.contextInfo ||
    msg.buttonsResponseMessage?.contextInfo ||
    msg.templateButtonReplyMessage?.contextInfo ||
    msg.interactiveResponseMessage?.contextInfo ||
    msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    null;
  return ctx?.stanzaId || "";
}

async function responder(conn, msg, texto) {
  try {
    return recordarPropio(conn, await conn.sendMessage(msg.key.remoteJid, { text: texto }, { quoted: msg })
    );
  } catch {}
}

const reaccionar = (conn, msg, emoji) =>
  conn.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});

// ------------------------------------------------------------
// Opciones del menú de setmenu
// ------------------------------------------------------------
function construirOpciones() {
  const disenos = getDisenos();
  const opciones = [];

  for (const d of disenos) {
    opciones.push({
      id: `setmenu_diseno_${d.id}`,
      titulo: `${d.emoji || "🎨"} Diseño ${d.id} — ${d.nombre}`,
      desc: d.descripcion || "",
      accion: { tipo: "diseno", valor: d.id }
    });
  }

  opciones.push(
    {
      id: "setmenu_media_global",
      titulo: "🖼️ Imagen/video para TODOS los menús",
      desc: "Una sola media para todos los menús",
      accion: { tipo: "media", valor: "global" }
    },
    {
      id: "setmenu_media_menu",
      titulo: "🎯 Imagen/video de UN menú",
      desc: "Media distinta solo para el menú que elijas",
      accion: { tipo: "media_elegir" }
    },
    {
      id: "setmenu_nombre",
      titulo: "✏️ Nombre del bot",
      desc: "Reemplaza la marca en los menús y descargas",
      accion: { tipo: "nombre" }
    },
    {
      id: "setmenu_foto",
      titulo: "📸 Foto de perfil",
      desc: "Cambia la foto de perfil del bot",
      accion: { tipo: "foto" }
    },
    {
      id: "setmenu_ver",
      titulo: "👀 Ver personalización actual",
      desc: "Muestra diseño, nombre e imágenes guardadas",
      accion: { tipo: "ver" }
    }
  );

  return opciones;
}

function opcionPorId(id) {
  const limpio = String(id || "").trim();
  return construirOpciones().find(
    (o) => o.id === limpio || limpio.endsWith(o.id)
  );
}

function opcionPorNumero(n) {
  const ops = construirOpciones();
  const i = Number(n);
  if (!Number.isInteger(i) || i < 1 || i > ops.length) return null;
  return ops[i - 1];
}

function textoOpciones(pref) {
  const ops = construirOpciones();
  const lineas = ops.map((o, i) => `*${i + 1}.* ${o.titulo}\n     _${o.desc}_`);
  return (
    `🎨 *PERSONALIZACIÓN*\n\n` +
    `Responde a este mensaje con el *número* de la opción que quieras:\n\n` +
    lineas.join("\n") +
    `\n\n💡 También puedes usar *${pref}setmenu 3* para poner el diseño 3 directo.` +
    `\n🧹 Para borrar todo y volver de fábrica: *${pref}delmenu*`
  );
}

function botonesSetmenu() {
  const ops = construirOpciones();
  const disenos = ops.filter((o) => o.id.startsWith("setmenu_diseno_"));
  const resto = ops.filter((o) => !o.id.startsWith("setmenu_diseno_"));

  return [
    {
      text: "🎨 Abrir personalización",
      sections: [
        {
          title: "🎨 DISEÑOS",
          highlight_label: "7 estilos",
          rows: disenos.map((o) => ({
            header: "",
            title: o.titulo,
            description: o.desc,
            id: o.id
          }))
        },
        {
          title: "🖼️ IMAGEN Y NOMBRE",
          rows: resto.map((o) => ({
            header: "",
            title: o.titulo,
            description: o.desc,
            id: o.id
          }))
        }
      ]
    }
  ];
}

// ------------------------------------------------------------
// Acciones
// ------------------------------------------------------------
async function aplicarDiseno(conn, msg, id) {
  const d = getDiseno(id);
  if (!d) return responder(conn, msg, "❌ Ese diseño no existe. Elige del *1* al *7*.");

  const perso = getPerso(conn);
  perso.diseno = Number(d.id);
  savePerso(conn, perso);

  await reaccionar(conn, msg, "✅");
  return responder(
    conn,
    msg,
    `✅ *Diseño aplicado:* ${d.emoji || ""} *${d.nombre}*\n_${d.descripcion || ""}_\n\n` +
      `Ya se ve en todos tus menús y en los comandos de descarga.\n` +
      `Mira cómo quedó con *${(conn?.subPrefixes || global.prefixes || ["."])[0]}menu*`
  );
}

async function pedirMedia(conn, msg, clave) {
  setPendiente(conn, msg, { paso: "media", clave });
  const nombre =
    clave === "global" ? "TODOS los menús" : `el *${MENU_NOMBRES[clave] || clave}*`;
  return responder(
    conn,
    msg,
    `🖼️ *Envía ahora la imagen o el video* que quieres para ${nombre}.\n\n` +
      `• Puedes mandarla directo o responder a una que ya esté en el chat.\n` +
      `• Si mandas un *video corto* se usará como GIF animado.\n` +
      `• Máximo ${MAX_MEDIA_MB} MB.\n\n` +
      `⏳ Tienes 5 minutos. Escribe *cancelar* para salir.`
  );
}

async function pedirMenuParaMedia(conn, msg) {
  setPendiente(conn, msg, { paso: "elegir_menu" });
  const lista = MENUS_ELEGIBLES.map(
    (k, i) => `*${i + 1}.* ${MENU_NOMBRES[k] || k}`
  ).join("\n");
  return responder(
    conn,
    msg,
    `🎯 *¿A qué menú le quieres poner su propia imagen?*\n\n${lista}\n\n` +
      `Responde con el número.\n⏳ Tienes 5 minutos. Escribe *cancelar* para salir.`
  );
}

async function pedirNombre(conn, msg) {
  setPendiente(conn, msg, { paso: "nombre" });
  return responder(
    conn,
    msg,
    `✏️ *Escribe el nombre que quieres para tu bot.*\n\n` +
      `Va a reemplazar la marca en todos los menús y en los comandos de descarga.\n\n` +
      `⏳ Tienes 5 minutos. Escribe *cancelar* para salir.`
  );
}

async function pedirFoto(conn, msg) {
  setPendiente(conn, msg, { paso: "foto" });
  return responder(
    conn,
    msg,
    `📸 *Envía ahora la imagen* que quieres como foto de perfil del bot.\n\n` +
      `Puedes mandarla directo o responder a una imagen del chat.\n\n` +
      `⏳ Tienes 5 minutos. Escribe *cancelar* para salir.`
  );
}

async function mostrarPersonalizacion(conn, msg) {
  const p = getPerso(conn);
  const d = getDiseno(p.diseno || 1);
  const marcaFab = esSubbot(conn) ? MARCA_FABRICA_SUB : MARCA_FABRICA_MAIN;

  const medias = [];
  if (p.mediaGlobal) {
    medias.push(`• Todos los menús: ${p.mediaGlobal.tipo === "video" ? "video/gif" : "imagen"}`);
  }
  for (const k of MENUS_ELEGIBLES) {
    const m = p.medias?.[k];
    if (m) medias.push(`• ${MENU_NOMBRES[k] || k}: ${m.tipo === "video" ? "video/gif" : "imagen"}`);
  }

  const texto =
    `👀 *TU PERSONALIZACIÓN*\n\n` +
    `🎨 *Diseño:* ${p.diseno ? `${d?.emoji || ""} ${d?.nombre} (${p.diseno})` : "1 · Clásico (de fábrica)"}\n` +
    `✏️ *Nombre:* ${p.nombre || `${marcaFab} (de fábrica)`}\n` +
    `🖼️ *Imágenes propias:*\n${medias.length ? medias.join("\n") : "• Ninguna (se usan las de fábrica)"}\n\n` +
    (p.updatedAt ? `🕐 Última actualización: ${new Date(p.updatedAt).toLocaleString("es-ES")}` : "");

  return responder(conn, msg, texto.trim());
}

async function ejecutarAccion(conn, msg, opcion) {
  const a = opcion?.accion;
  if (!a) return;

  if (a.tipo === "diseno") return aplicarDiseno(conn, msg, a.valor);
  if (a.tipo === "media") return pedirMedia(conn, msg, a.valor);
  if (a.tipo === "media_elegir") return pedirMenuParaMedia(conn, msg);
  if (a.tipo === "nombre") return pedirNombre(conn, msg);
  if (a.tipo === "foto") return pedirFoto(conn, msg);
  if (a.tipo === "ver") return mostrarPersonalizacion(conn, msg);
}

// ------------------------------------------------------------
// Guardado de los pasos pendientes
// ------------------------------------------------------------
async function guardarPasoMedia(conn, msg, pend) {
  const media = mediaDe(msg);
  if (!media) {
    return responder(
      conn,
      msg,
      "⚠️ Eso no es una imagen ni un video. Envía la media o escribe *cancelar*."
    );
  }

  const tam = Number(media.nodo?.fileLength || 0);
  if (tam && tam > MAX_MEDIA_MB * 1024 * 1024) {
    return responder(
      conn,
      msg,
      `❌ El archivo pesa más de ${MAX_MEDIA_MB} MB. Manda uno más liviano.`
    );
  }

  await reaccionar(conn, msg, "⏳");

  let buffer;
  try {
    buffer = await descargar(conn, media.nodo, media.tipo);
  } catch (e) {
    console.error("[setmenu] Error descargando media:", e.message);
    return responder(conn, msg, "❌ No se pudo descargar la media. Intenta de nuevo.");
  }

  if (!buffer?.length) {
    return responder(conn, msg, "❌ La media llegó vacía. Intenta de nuevo.");
  }

  const clave = pend.clave === "global" ? "global" : pend.clave;
  const reg = guardarMedia(conn, buffer, media.tipo, clave);
  if (!reg) return responder(conn, msg, "❌ No se pudo guardar la media.");

  const perso = getPerso(conn);
  if (clave === "global") {
    perso.mediaGlobal = reg;
  } else {
    perso.medias = perso.medias || {};
    perso.medias[clave] = reg;
  }
  savePerso(conn, perso);
  setPendiente(conn, msg, { paso: "menu" }); // sigue con el menú abierto

  await reaccionar(conn, msg, "✅");
  const donde =
    clave === "global" ? "todos los menús" : `el *${MENU_NOMBRES[clave] || clave}*`;
  return responder(
    conn,
    msg,
    `✅ *Media guardada* para ${donde}.\n` +
      `${media.tipo === "video" ? "🎞️ Se enviará como GIF animado." : "🖼️ Imagen lista."}\n\n` +
      `💡 Si quieres una distinta para otro menú, abre *setmenu* y elige _Imagen/video de UN menú_.`
  );
}

async function guardarPasoNombre(conn, msg) {
  const nombre = textoDe(msg).slice(0, 60).trim();
  if (!nombre) {
    return responder(conn, msg, "⚠️ Escribe un nombre válido o *cancelar*.");
  }

  const perso = getPerso(conn);
  perso.nombre = nombre;
  savePerso(conn, perso);
  setPendiente(conn, msg, { paso: "menu" }); // sigue con el menú abierto

  await reaccionar(conn, msg, "✅");
  return responder(
    conn,
    msg,
    `✅ *Nombre guardado:* ${nombre}\n\n` +
      `Ya sale en todos los menús y en los comandos de descarga en vez de la marca anterior.`
  );
}

async function guardarPasoFoto(conn, msg) {
  const media = mediaDe(msg);
  if (!media || media.tipo !== "image") {
    return responder(conn, msg, "⚠️ Envía una *imagen* para la foto de perfil, o escribe *cancelar*.");
  }

  await reaccionar(conn, msg, "⏳");

  try {
    const buffer = await descargar(conn, media.nodo, "image");
    if (!buffer?.length) throw new Error("imagen vacía");
    await conn.updateProfilePicture(conn.user.id, buffer);
  } catch (e) {
    console.error("[setmenu] Error cambiando foto de perfil:", e.message);
    return responder(conn, msg, "❌ No se pudo cambiar la foto de perfil. Intenta de nuevo.");
  }

  setPendiente(conn, msg, { paso: "menu" }); // sigue con el menú abierto
  await reaccionar(conn, msg, "✅");
  return responder(conn, msg, "✅ *Foto de perfil actualizada.*");
}

async function guardarPasoElegirMenu(conn, msg) {
  const n = Number(textoDe(msg).replace(/[^0-9]/g, ""));
  const clave = MENUS_ELEGIBLES[n - 1];
  if (!clave) {
    return responder(
      conn,
      msg,
      `⚠️ Número inválido. Elige del *1* al *${MENUS_ELEGIBLES.length}* o escribe *cancelar*.`
    );
  }
  return pedirMedia(conn, msg, clave);
}

// ------------------------------------------------------------
// Listener de respuestas (se registra una vez por conexión)
// ------------------------------------------------------------
function registrarListener(conn, puedeUsar) {
  if (conn._setmenuListener) return;
  conn._setmenuListener = true;

  conn.ev.on("messages.upsert", async (ev) => {
    for (const m of ev.messages || []) {
      try {
        if (!m?.message) continue;

        // 🚫 Nunca tomar como respuesta un mensaje que enviamos nosotros
        // (en subbots el dueño también es fromMe, por eso se comprueba el ID
        // y además el texto con el que empiezan nuestros avisos).
        if (esIdPropio(conn, m.key?.id)) continue;

        // Solo atendemos a quien tiene permiso (owner / el propio subbot)
        if (!puedeUsar(m, conn)) continue;

        const textoCrudo = textoDe(m);
        if (esTextoPropio(textoCrudo)) continue;

        const pend = getPendiente(conn, m);
        const texto = textoCrudo.toLowerCase();

        // Cancelar en cualquier paso
        if (pend && (texto === "cancelar" || texto === "cancel")) {
          borrarPendiente(conn, m);
          await responder(conn, m, "🚪 Personalización cancelada.");
          continue;
        }

        // Paso pendiente en curso
        if (pend) {
          if (pend.paso === "media") {
            if (mediaDe(m)) {
              await guardarPasoMedia(conn, m, pend);
              continue;
            }
          } else if (pend.paso === "foto") {
            if (mediaDe(m)) {
              await guardarPasoFoto(conn, m);
              continue;
            }
          } else if (pend.paso === "nombre") {
            if (texto) {
              await guardarPasoNombre(conn, m);
              continue;
            }
          } else if (pend.paso === "elegir_menu") {
            if (/^\d+$/.test(texto)) {
              await guardarPasoElegirMenu(conn, m);
              continue;
            }
          }
        }

        // Selección desde el menú de botones
        const respuesta =
          m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
          m.message?.listResponseMessage ||
          m.message?.buttonsResponseMessage ||
          m.message?.templateButtonReplyMessage ||
          null;

        if (respuesta) {
          // 🎯 Solo atendemos la selección si el usuario tocó NUESTRO menú.
          // Si no se puede saber a qué mensaje responde, exigimos que este
          // bot haya abierto el menú aquí (sesión activa).
          const citado = idCitado(m);
          if (citado) {
            if (!esIdPropio(conn, citado)) continue; // era el menú de otro bot
          } else if (!pend) {
            continue;
          }

          let id = "";
          if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
            id = m.message.listResponseMessage.singleSelectReply.selectedRowId;
          } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
            id = m.message.buttonsResponseMessage.selectedButtonId;
          } else if (m.message?.templateButtonReplyMessage?.selectedId) {
            id = m.message.templateButtonReplyMessage.selectedId;
          } else if (respuesta?.paramsJson) {
            try {
              id = JSON.parse(respuesta.paramsJson)?.id || "";
            } catch {}
          }

          if (id && id.includes("setmenu_")) {
            const op = opcionPorId(id);
            if (op) {
              await ejecutarAccion(conn, m, op);
              continue;
            }
          }

          if (id && id.includes("delmenu_")) {
            await resolverDelmenu(conn, m, id.includes("confirmar"));
            continue;
          }
        }

        // Respuesta con número citando el menú en texto (iPhone / fallback)
        if (/^\d{1,2}$/.test(texto)) {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          // Igual que arriba: solo si citó NUESTRO menú
          const idDelCitado = ctx?.stanzaId || "";
          if (idDelCitado && !esIdPropio(conn, idDelCitado)) continue;

          const citado = ctx?.quotedMessage;
          const textoCitado = citado
            ? String(
                citado.conversation ||
                  citado.extendedTextMessage?.text ||
                  citado.imageMessage?.caption ||
                  citado.videoMessage?.caption ||
                  ""
              )
            : "";

          if (textoCitado.includes("PERSONALIZACIÓN")) {
            const op = opcionPorNumero(texto);
            if (op) {
              await ejecutarAccion(conn, m, op);
              continue;
            }
          }
        }

        // Confirmación de delmenu por texto
        if (pend?.paso === "delmenu" && texto) {
          await resolverDelmenu(conn, m, texto === "confirmar" || texto === "si" || texto === "sí");
          continue;
        }
      } catch (e) {
        console.error("[setmenu] Error en listener:", e.message);
      }
    }
  });
}

// ------------------------------------------------------------
// API pública
// ------------------------------------------------------------

/**
 * Abre el sistema de personalización.
 * puedeUsar(msg, conn) → boolean: lo llama también el listener para las respuestas.
 */
export async function abrirSetmenu(msg, conn, { puedeUsar, args = [] } = {}) {
  const chatId = msg.key.remoteJid;
  const pref = (conn?.subPrefixes || global.prefixes || ["."])[0] || ".";

  registrarListener(conn, puedeUsar);

  // Atajo directo: .setmenu 3
  const directo = String(args?.[0] || "").trim();
  if (/^\d+$/.test(directo)) {
    return aplicarDiseno(conn, msg, directo);
  }

  await reaccionar(conn, msg, "🎨");

  const marca = getMarca(conn);
  const perso = getPerso(conn);
  const d = getDiseno(perso.diseno || 1);

  const cabecera =
    `🎨 *PERSONALIZACIÓN DE ${marca.toUpperCase()}*\n\n` +
    `🎨 Diseño actual: *${d?.emoji || ""} ${d?.nombre || "Clásico"}*\n` +
    `✏️ Nombre actual: *${marca}*\n\n` +
    `Elige qué quieres cambiar 👇`;

  // Sesión abierta en ESTE bot: si la selección llega sin referencia al
  // mensaje del menú, solo actúa el bot que realmente lo abrió aquí.
  setPendiente(conn, msg, { paso: "menu" });

  // iPhone: sin botones, con opciones numeradas
  if (esIphone(msg)) {
    return recordarPropio(conn, await conn.sendMessage(chatId, { text: textoOpciones(pref) }, { quoted: msg }));
  }

  try {
    return recordarPropio(conn, await conn.sendMessage(
      chatId,
      {
        text: cabecera,
        footer: `❦ ${marca} ❦`,
        buttons: botonesSetmenu(),
        headerType: 1
      },
      { quoted: msg }
    ));
  } catch (e) {
    console.log("[setmenu] Botones fallaron, usando texto:", e.message);
    return recordarPropio(conn, await conn.sendMessage(chatId, { text: textoOpciones(pref) }, { quoted: msg }));
  }
}

/** Pide confirmación antes de borrar toda la personalización */
export async function abrirDelmenu(msg, conn, { puedeUsar } = {}) {
  const chatId = msg.key.remoteJid;

  registrarListener(conn, puedeUsar);

  if (!hayPersonalizacion(conn)) {
    return responder(
      conn,
      msg,
      "ℹ️ No tienes ninguna personalización guardada. Todo ya está de fábrica."
    );
  }

  setPendiente(conn, msg, { paso: "delmenu" });

  const aviso =
    `⚠️ *¿SEGURO QUE QUIERES BORRAR TODO?*\n\n` +
    `Se van a borrar:\n` +
    `• 🎨 El diseño elegido\n` +
    `• ✏️ El nombre personalizado\n` +
    `• 🖼️ Todas las imágenes y videos de los menús\n\n` +
    `Todo volverá de fábrica. *Esto no se puede deshacer.*\n\n` +
    `Responde *confirmar* para borrar o *cancelar* para dejarlo así.`;

  if (esIphone(msg)) {
    return recordarPropio(conn, await conn.sendMessage(chatId, { text: aviso }, { quoted: msg }));
  }

  try {
    return recordarPropio(conn, await conn.sendMessage(
      chatId,
      {
        text: aviso,
        footer: "Esta acción no se puede deshacer",
        buttons: [
          {
            text: "⚠️ Elegir una opción",
            sections: [
              {
                title: "¿Borrar la personalización?",
                rows: [
                  {
                    header: "",
                    title: "🗑️ Sí, borrar todo",
                    description: "Deja el bot de fábrica",
                    id: "delmenu_confirmar"
                  },
                  {
                    header: "",
                    title: "🚪 No, cancelar",
                    description: "Deja mi personalización como está",
                    id: "delmenu_cancelar"
                  }
                ]
              }
            ]
          }
        ],
        headerType: 1
      },
      { quoted: msg }
    ));
  } catch {
    return recordarPropio(conn, await conn.sendMessage(chatId, { text: aviso }, { quoted: msg }));
  }
}

async function resolverDelmenu(conn, msg, confirmado) {
  borrarPendiente(conn, msg);

  if (!confirmado) {
    return responder(conn, msg, "🚪 Cancelado. Tu personalización sigue igual.");
  }

  const ok = borrarPerso(conn);
  await reaccionar(conn, msg, ok ? "✅" : "ℹ️");

  return responder(
    conn,
    msg,
    ok
      ? "✅ *Personalización borrada.*\nDiseño, nombre e imágenes volvieron de fábrica."
      : "ℹ️ No había nada que borrar."
  );
}
