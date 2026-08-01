// ventas-core.js — Núcleo de los comandos de ventas.
//
// Cada comando de ventas son en realidad dos:
//   • el que MUESTRA lo guardado   (ej. .stock)
//   • el que lo CONFIGURA          (ej. .setstock)
//
// Todo se guarda en ./ventas365.json separado por chat, así cada grupo tiene
// su propio contenido. El formato es el mismo que ya usaban los comandos
// antiguos ({ texto, imagen en base64 }), para no romper lo que ya está
// configurado en los grupos.

import fs from "fs";

// Detección de admin/owner compartida con el resto del bot (la misma que usan
// .abrir y .cerrar). Resuelve las cuentas que WhatsApp entrega como @lid: sin
// esto, en esos grupos los admins salían como si no lo fueran.
import { isAdminByNumber, isOwnerCheck, numeroDelRemitente } from "./libs/adminCheck.js";

const ARCHIVO = "./ventas365.json";

// ------------------------------------------------------------
// Helpers de mensajes
// ------------------------------------------------------------
function desenvolver(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message ||
    n?.documentWithCaptionMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message ||
      n.documentWithCaptionMessage?.message;
  }
  return n;
}

function contextoDe(msg) {
  const m = desenvolver(msg?.message) || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null
  );
}

/** Texto del mensaje citado, respetando saltos de línea */
function textoCitado(msg) {
  const q = contextoDe(msg)?.quotedMessage;
  if (!q) return null;
  const inner = desenvolver(q) || {};
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    null
  );
}

/** Imagen citada (soporta viewOnce y mensajes temporales) */
function imagenCitada(msg) {
  const q = contextoDe(msg)?.quotedMessage;
  if (!q) return null;
  const inner = desenvolver(q) || {};
  return inner.imageMessage || null;
}

/** Imagen enviada junto al propio comando */
function imagenPropia(msg) {
  const m = desenvolver(msg?.message) || {};
  return m.imageMessage || null;
}

/** downloadContentFromMessage esté donde esté inyectado */
function descargador(conn, wa) {
  for (const fuente of [wa, conn?.wa, global?.wa]) {
    if (typeof fuente?.downloadContentFromMessage === "function") return fuente;
  }
  return null;
}

async function aBase64(conn, wa, nodo) {
  const WA = descargador(conn, wa);
  if (!WA) throw new Error("downloadContentFromMessage no disponible");
  const stream = await WA.downloadContentFromMessage(nodo, "image");
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer.length ? buffer.toString("base64") : null;
}

// ------------------------------------------------------------
// Acceso al archivo de ventas
// ------------------------------------------------------------
function leerDatos() {
  if (!fs.existsSync(ARCHIVO)) return {};
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, "utf-8")) || {};
  } catch (e) {
    console.error("[ventas] ventas365.json ilegible:", e.message);
    return {};
  }
}

function guardarDatos(datos) {
  fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2));
}

/** Lo guardado para un comando en un chat concreto (null si no hay nada) */
export function getVenta(chatId, clave) {
  const guardado = leerDatos()?.[chatId]?.[`set${clave}`];
  if (!guardado) return null;
  // Formato viejo: solo un string
  if (typeof guardado === "string") return { texto: guardado, imagen: null };
  if (!guardado.texto && !guardado.imagen) return null;
  return guardado;
}

/** Comandos de ventas que este chat tiene configurados */
export function ventasConfiguradas(chatId) {
  const delChat = leerDatos()?.[chatId] || {};
  return Object.keys(delChat)
    .filter((k) => k.startsWith("set"))
    .map((k) => k.slice(3));
}

// ------------------------------------------------------------
// Fábrica de comandos
// ------------------------------------------------------------
/**
 * Crea el handler que atiende TANTO al comando que muestra el contenido
 * como al `set...` que lo configura.
 *
 * @param {string}   clave        Nombre bajo el que se guarda (ej. "stock")
 * @param {string[]} comandos     Los que muestran (ej. ["stock"])
 * @param {string[]} setComandos  Los que configuran (ej. ["setstock"])
 * @param {string}   titulo       Nombre bonito para los avisos
 * @param {string}   emoji        Emoji del comando
 */
export function crearVenta({ clave, comandos, setComandos, titulo, emoji = "🛒" }) {
  const nombres = new Set(comandos.map((c) => c.toLowerCase()));
  const nombresSet = new Set(setComandos.map((c) => c.toLowerCase()));
  const principal = comandos[0];
  const principalSet = setComandos[0];

  const handler = async (msg, { conn, args, text, wa, command } = {}) => {
    const chatId = msg.key.remoteJid;
    const cmd = String(command || "").toLowerCase();

    // ---------- Configurar ----------
    if (nombresSet.has(cmd)) {
      const enGrupo = chatId.endsWith("@g.us");
      if (!enGrupo) {
        return conn.sendMessage(
          chatId,
          { text: "❌ Este comando solo funciona en grupos." },
          { quoted: msg }
        );
      }

      const quien = numeroDelRemitente(msg);

      if (
        !msg.key.fromMe &&
        !isOwnerCheck(quien) &&
        !(await isAdminByNumber(conn, chatId, quien))
      ) {
        return conn.sendMessage(
          chatId,
          { text: "🚫 Solo administradores u owners pueden usar este comando." },
          { quoted: msg }
        );
      }

      // Texto tal cual lo escribió, sin tocar saltos ni espacios
      const crudo =
        typeof text === "string" ? text : Array.isArray(args) ? args.join(" ") : "";
      const escrito = crudo.startsWith(" ") ? crudo.slice(1) : crudo;
      const citado = escrito ? null : textoCitado(msg);
      const nodoImagen = imagenPropia(msg) || imagenCitada(msg);

      if (!escrito && !citado && !nodoImagen) {
        return conn.sendMessage(
          chatId,
          {
            text:
              `${emoji} *${titulo.toUpperCase()}*\n\n` +
              `Para configurarlo usa:\n` +
              `• *${principalSet} <texto>* — se admiten varias líneas\n` +
              `• O responde a una *imagen* con *${principalSet} <texto>*\n\n` +
              `Después cualquiera lo ve escribiendo *${principal}*`
          },
          { quoted: msg }
        );
      }

      let imagen = null;
      if (nodoImagen) {
        try {
          imagen = await aBase64(conn, wa, nodoImagen);
        } catch (e) {
          console.error(`[set${clave}] no se pudo leer la imagen:`, e.message);
        }
      }

      const datos = leerDatos();
      if (!datos[chatId]) datos[chatId] = {};

      // Si mandan solo una imagen nueva, se conserva el texto que ya había
      const anterior = datos[chatId][`set${clave}`] || {};
      const textoFinal = escrito || citado || (imagen ? anterior.texto || "" : "");

      datos[chatId][`set${clave}`] = {
        texto: textoFinal,
        imagen: imagen || (escrito || citado ? anterior.imagen || null : null)
      };
      guardarDatos(datos);

      return conn.sendMessage(
        chatId,
        {
          text:
            `✅ *${titulo.toUpperCase()} configurado correctamente.*\n\n` +
            `Míralo escribiendo *${principal}*`
        },
        { quoted: msg }
      );
    }

    // ---------- Mostrar ----------
    if (!nombres.has(cmd)) return;

    const guardado = getVenta(chatId, clave);
    if (!guardado) {
      return conn.sendMessage(
        chatId,
        {
          text:
            `${emoji} No hay *${titulo}* configurado en este chat.\n\n` +
            `Un admin puede ponerlo con *${principalSet} <texto>*`
        },
        { quoted: msg }
      );
    }

    if (guardado.imagen) {
      return conn.sendMessage(
        chatId,
        { image: Buffer.from(guardado.imagen, "base64"), caption: guardado.texto || "" },
        { quoted: msg }
      );
    }

    return conn.sendMessage(chatId, { text: guardado.texto }, { quoted: msg });
  };

  handler.command = [...comandos, ...setComandos];
  handler.help = [...comandos, ...setComandos];
  handler.tags = ["ventas"];
  handler.ventas = { clave, comandos, setComandos, titulo, emoji };

  return handler;
}
