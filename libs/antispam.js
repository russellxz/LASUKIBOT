// libs/antispam.js — Corta el spam de repetir lo mismo una y otra vez.
//
// Cómo funciona: se lleva la cuenta de cuántas veces seguidas alguien manda
// el mismo texto. Las tres primeras pasan. De la cuarta en adelante el bot
// borra el mensaje, y al llegar a siete lo saca del grupo.
//
// Se aplica a todo el mundo, admins incluidos: si no, el spam de un admin no
// se podría cortar.
//
// El contador vive en memoria (el spam es cosa del momento, no hace falta
// guardarlo en disco) y va separado por bot, para que el principal y cada
// subbot no se pisen las cuentas aunque compartan proceso.

"use strict";

import { setConfig, getConfig } from "../db.js";

export const REPETIR_PARA_BORRAR = 3;   // las 3 primeras pasan; de la 4ª en adelante se borra
export const REPETIR_PARA_SACAR = 7;    // a la 7ª, fuera del grupo
const PALABRA_REPETIDA = 5;             // "hola hola hola hola hola" en un solo mensaje
const OLVIDAR_MS = 5 * 60 * 1000;       // 5 min sin escribir y se reinicia la cuenta
const MAX_EN_MEMORIA = 5000;

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// clave: <bot>|<grupo>|<numero>  →  { texto, veces, ultima }
const cuentas = new Map();

function quienEs(conn) {
  return String(conn?.subbotNumber || conn?.user?.id || "main");
}

// Para comparar dos mensajes: sin acentos, sin signos, sin repetir espacios y
// sin letras estiradas, porque "holaaaa" y "holaaaaaa" son el mismo spam.
export function normalizar(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // fuera los acentos
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^\w\sáéíóúñ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ¿El mensaje repite la misma palabra muchas veces él solo?
export function palabraRepetida(texto = "") {
  const palabras = normalizar(texto).split(" ").filter((p) => p.length > 1);
  if (palabras.length < PALABRA_REPETIDA) return null;

  const cuenta = new Map();
  for (const p of palabras) cuenta.set(p, (cuenta.get(p) || 0) + 1);

  for (const [palabra, veces] of cuenta) {
    if (veces >= PALABRA_REPETIDA) return { palabra, veces };
  }

  return null;
}

function limpiarViejos(ahora) {
  if (cuentas.size < MAX_EN_MEMORIA) return;

  for (const [k, v] of cuentas) {
    if (ahora - v.ultima > OLVIDAR_MS) cuentas.delete(k);
  }
}

/** Reinicia la cuenta de alguien (se usa al expulsarlo). */
export function reiniciar(conn, chatId, numero) {
  cuentas.delete(`${quienEs(conn)}|${chatId}|${DIGITS(numero)}`);
}

/**
 * Apunta el mensaje y dice qué hay que hacer con él.
 * @returns {{veces:number, borrar:boolean, sacar:boolean, palabra:string}}
 */
export function apuntar(conn, chatId, numero, texto) {
  const limpio = normalizar(texto);
  if (!limpio) return { veces: 0, borrar: false, sacar: false, palabra: "" };

  const ahora = Date.now();
  limpiarViejos(ahora);

  const clave = `${quienEs(conn)}|${chatId}|${DIGITS(numero)}`;
  const previo = cuentas.get(clave);

  // Una sola palabra repetida dentro del mensaje ya cuenta como spam, sin
  // esperar a que lo mande cuatro veces.
  const dentro = palabraRepetida(texto);

  let veces;
  if (previo && previo.texto === limpio && ahora - previo.ultima <= OLVIDAR_MS) {
    veces = previo.veces + 1;
  } else {
    veces = 1;
  }

  cuentas.set(clave, { texto: limpio, veces, ultima: ahora });

  const porRepetir = veces > REPETIR_PARA_BORRAR;
  const borrar = porRepetir || !!dentro;
  const sacar = veces >= REPETIR_PARA_SACAR;

  return {
    veces,
    borrar,
    sacar,
    palabra: dentro ? dentro.palabra : "",
    vecesPalabra: dentro ? dentro.veces : 0
  };
}

// ---------------------------------------------------------------- moderación

function configDe(conn) {
  if (typeof conn?.getSubConfig === "function") {
    return { leer: (c, k) => conn.getSubConfig(c, k) };
  }
  return { leer: getConfig };
}

function textoDe(m) {
  const raiz = m?.message || {};
  return (
    raiz.conversation ||
    raiz.extendedTextMessage?.text ||
    raiz.imageMessage?.caption ||
    raiz.videoMessage?.caption ||
    ""
  );
}

/**
 * Revisa un mensaje y actúa si es spam repetido.
 * @returns {Promise<boolean>} true si borró el mensaje.
 */
export async function revisarSpam(conn, m, { owners = [] } = {}) {
  try {
    const chatId = m?.key?.remoteJid;

    if (!chatId || !chatId.endsWith("@g.us")) return false;
    if (m.key.fromMe) return false;

    const cfg = configDe(conn);
    if (Number(cfg.leer(chatId, "antispam")) !== 1) return false;

    const texto = textoDe(m);
    if (!texto || texto.length < 2) return false;

    const autorJid = m.realJid || m.key.participant || chatId;
    const autorNum = DIGITS(String(m.realNumber || autorJid).split(":")[0]);

    // Los dueños del bot se salvan; los admins del grupo no, a propósito.
    if (owners.some((o) => DIGITS(Array.isArray(o) ? o[0] : o) === autorNum)) return false;

    const r = apuntar(conn, chatId, autorNum, texto);
    if (!r.borrar) return false;

    try {
      await conn.sendMessage(chatId, { delete: m.key });
    } catch (e) {
      console.error("[antispam] no pude borrar (¿el bot no es admin?):", e.message);
      return false;
    }

    const motivo = r.palabra
      ? `repetir "${r.palabra}" ${r.vecesPalabra} veces en un mensaje`
      : `mandar lo mismo ${r.veces} veces seguidas`;

    console.log(`[antispam] ${chatId} · ${autorNum} · ${motivo}`);

    if (r.sacar) {
      await conn.sendMessage(chatId, {
        text:
`🚫 *EXPULSADO POR SPAM*

👤 @${autorNum}
📊 ${r.veces} mensajes iguales seguidos

Se avisó y no paró.`,
        mentions: [autorJid]
      });

      try {
        await conn.groupParticipantsUpdate(chatId, [autorJid], "remove");
        reiniciar(conn, chatId, autorNum);
      } catch (e) {
        console.error("[antispam] no pude expulsar:", e.message);
        await conn.sendMessage(chatId, {
          text: "⚠️ No pude expulsarlo: necesito ser administrador del grupo."
        });
      }

      return true;
    }

    // Solo se avisa la primera vez que se le empieza a borrar, para no
    // llenar el grupo de mensajes del bot mientras el otro insiste.
    if (r.veces === REPETIR_PARA_BORRAR + 1 || r.palabra) {
      await conn.sendMessage(chatId, {
        text:
`🔇 *Mensaje borrado por spam*

👤 @${autorNum}
📝 Motivo: ${motivo}

Si sigues, a los *${REPETIR_PARA_SACAR}* seguidos sales del grupo.`,
        mentions: [autorJid]
      });
    }

    return true;
  } catch (e) {
    console.error("[antispam] error:", e?.message || e);
    return false;
  }
}

export default { revisarSpam, apuntar, reiniciar, normalizar, palabraRepetida };
