// libs/antispam.js — Corta el spam de mandar lo mismo una y otra vez.
//
// Solo se mira una cosa: cuántas veces manda alguien el mismo mensaje. Los 3
// primeros pasan, del 4º en adelante se borran y al llegar a 7 lo saca del
// grupo.
//
// Para que la cuenta vuelva a cero hay que esperar 3 minutos sin mandarlo. Si
// lo manda antes, cuenta como una vez más.
//
// Lo que lleve escrito el mensaje da igual: "aaaaaaaaaaaaaa", "hhhhhh" o
// "jajajajaja" no son spam por sí solos, por muchas letras que repitan. Lo
// son cuando se mandan varias veces, igual que cualquier otro mensaje.
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

// Lo que hay que esperar sin mandar lo mismo para que la cuenta vuelva a cero.
export const ESPERA_MINUTOS = 3;
const ESPERA_MS = ESPERA_MINUTOS * 60 * 1000;

const MAX_EN_MEMORIA = 5000;

// Etiqueta interna para meter en el mismo saco todos los mensajes de una sola
// letra. No puede chocar con ningún texto real porque lleva un carácter nulo.
const SACO_UNA_LETRA = "\u0000una-letra";

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// clave: <bot>|<grupo>|<numero>  →  { texto, veces, ultima }
const cuentas = new Map();

function quienEs(conn) {
  return String(conn?.subbotNumber || conn?.user?.id || "main");
}

// Para comparar dos mensajes: sin acentos, sin signos, sin repetir espacios y
// con las letras estiradas recortadas a una sola, para que "hola", "holaaa" y
// "holaaaaaa" sean el mismo mensaje. Si se dejaran en dos, "hola" no casaría
// con "holaaa" y bastaría con ir alargando la palabra para escaparse.
//
// Efecto de paso: palabras que solo se diferencian en una letra doble ("caro"
// y "carro") quedan iguales. Da igual, solo sirve para contar repeticiones.
//
// Los emojis se dejan tal cual: mandar el mismo emoji cien veces también es
// spam, así que no se pueden tirar aquí.
export function normalizar(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // fuera los acentos
    .replace(/(.)\1+/gu, "$1")          // "hola" = "holaaa" = "holaaaaaa"
    .replace(/\p{P}/gu, "")             // fuera los signos, pero no los emojis
    .replace(/\s+/g, " ")
    .trim();
}

function limpiarViejos(ahora) {
  if (cuentas.size < MAX_EN_MEMORIA) return;

  for (const [k, v] of cuentas) {
    if (ahora - v.ultima > ESPERA_MS) cuentas.delete(k);
  }
}

/** Reinicia la cuenta de alguien (se usa al expulsarlo). */
export function reiniciar(conn, chatId, numero) {
  cuentas.delete(`${quienEs(conn)}|${chatId}|${DIGITS(numero)}`);
}

/**
 * Apunta el mensaje y dice qué hay que hacer con él.
 * @returns {{veces:number, borrar:boolean, sacar:boolean, tipoSpam:string}}
 */
export function apuntar(conn, chatId, numero, texto) {
  // Si al normalizar no queda nada (un mensaje de puros signos, por ejemplo)
  // se compara el original en crudo, para no dejar de contarlo.
  const limpio = normalizar(texto) ||
    String(texto || "").toLowerCase().replace(/\s+/g, " ").trim();

  if (!limpio) return { veces: 0, borrar: false, sacar: false, tipoSpam: "" };

  const ahora = Date.now();
  limpiarViejos(ahora);

  const clave = `${quienEs(conn)}|${chatId}|${DIGITS(numero)}`;
  const previo = cuentas.get(clave);

  // Los mensajes de una sola letra van todos al mismo saco, aunque vaya
  // cambiando de letra: mandar "a t u a t u a" es el mismo spam que mandar
  // "a a a a a a a". Con dos caracteres ya no, porque "si", "ok" o "ya"
  // son respuestas normales y no hay que borrárselas a nadie.
  const sueltas = [...limpio].length === 1;
  const comparar = sueltas ? SACO_UNA_LETRA : limpio;

  // Solo suma si lo repite antes de que pasen los 3 minutos. Cumplidos los 3
  // vuelve a empezar por uno: si se le pide esperar 3 minutos, a los 3 minutos
  // tiene que poder escribir.
  let veces;
  if (previo && previo.texto === comparar && ahora - previo.ultima < ESPERA_MS) {
    veces = previo.veces + 1;
  } else {
    veces = 1;
  }

  cuentas.set(clave, { texto: comparar, veces, ultima: ahora });

  const borrar = veces > REPETIR_PARA_BORRAR;

  return {
    veces,
    borrar,
    sacar: veces >= REPETIR_PARA_SACAR,
    tipoSpam: borrar ? (sueltas ? "sueltas" : "mensaje") : ""
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

    // Se cuenta cualquier mensaje con algo escrito, aunque sea una sola letra:
    // mandar "a" cincuenta veces es spam igual que mandar una frase.
    const texto = textoDe(m);
    if (!texto || !texto.trim()) return false;

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

    const motivo = r.tipoSpam === "sueltas"
      ? `mandar ${r.veces} letras sueltas seguidas`
      : `mandar lo mismo ${r.veces} veces seguidas`;

    console.log(`[antispam] ${chatId} · ${autorNum} · ${motivo}`);

    if (r.sacar) {
      await conn.sendMessage(chatId, {
        text:
`🚫 *EXPULSADO POR SPAM*

👤 @${autorNum}
📊 ${r.tipoSpam === "sueltas"
      ? `${r.veces} mensajes de una sola letra seguidos`
      : `${r.veces} mensajes iguales seguidos`}

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
    if (r.veces === REPETIR_PARA_BORRAR + 1) {
      await conn.sendMessage(chatId, {
        text:
`🔇 *Mensaje borrado por spam*

👤 @${autorNum}
📝 Motivo: ${motivo}

⏳ Espera *${ESPERA_MINUTOS} minutos* para volver a mandar lo mismo.
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

export default { revisarSpam, apuntar, reiniciar, normalizar };
