// libs/antispam.js — Corta el spam de repetir lo mismo una y otra vez.
//
// Dos formas de pillarlo:
//
//   1) Mensajes iguales seguidos. Los 3 primeros pasan, del 4º en adelante se
//      borran y al llegar a 7 lo saca del grupo.
//
//   2) Repeticiones dentro de un mismo mensaje. Da igual qué se repita: una
//      letra ("aaaaaaaaaa"), un número ("1111111111"), un emoji, una sílaba
//      ("jajajajajaja", "123123123123123123") o cualquier palabra, esté bien
//      o mal escrita ("asdkj asdkj asdkj asdkj asdkj"). Eso se borra al
//      momento, sin esperar al cuarto mensaje.
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

// Cuánto hay que repetir dentro de un mensaje para que cuente como spam.
// Si alguna resulta muy floja o muy dura en el grupo, se cambia aquí.
export const RACHA_PEGADA = 10;         // "aaaaaaaaaa" — la misma letra pegada
export const PATRON_REPETIDO = 6;       // "jajajajajaja" — "ja" seis veces
export const PALABRA_REPETIDA = 5;      // "hola hola hola hola hola"

const OLVIDAR_MS = 5 * 60 * 1000;       // 5 min sin escribir y se reinicia la cuenta
const MAX_EN_MEMORIA = 5000;

// Una letra, número o emoji pegado a sí mismo muchas veces.
const RE_RACHA = new RegExp(`(\\S)\\1{${RACHA_PEGADA - 1},}`, "u");

// Un trocito de 2 a 4 caracteres repetido sin parar: "ja"+"ja"+…, "123"+"123"+…
const RE_PATRON = new RegExp(`(.{2,4}?)\\1{${PATRON_REPETIDO - 1},}`, "u");

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// clave: <bot>|<grupo>|<numero>  →  { texto, veces, ultima }
const cuentas = new Map();

function quienEs(conn) {
  return String(conn?.subbotNumber || conn?.user?.id || "main");
}

// Para comparar dos mensajes: sin acentos, sin signos, sin repetir espacios y
// sin letras estiradas, porque "holaaaa" y "holaaaaaa" son el mismo spam.
// Los emojis se dejan tal cual: mandar el mismo emoji cien veces también es
// spam, así que no se pueden tirar aquí.
export function normalizar(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // fuera los acentos
    .replace(/(.)\1{2,}/gu, "$1$1")     // "holaaaa" = "holaaaaaa"
    .replace(/\p{P}/gu, "")             // fuera los signos, pero no los emojis
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El mensaje repite algo él solo? Vale cualquier cosa: una letra, un número,
 * un emoji, una sílaba o una palabra, esté bien escrita, mal escrita o sea
 * inventada.
 *
 * Se mira sobre el texto tal cual llegó, sin normalizar, porque normalizar
 * acorta las rachas ("aaaaaaaaaa" queda en "aa") y se perdería justo lo que
 * estamos buscando.
 *
 * @returns {{tipo:string, muestra:string, veces:number}|null}
 */
export function repeticionInterna(texto = "") {
  const crudo = String(texto || "");
  if (!crudo) return null;

  // 1) La misma letra/número/emoji pegada: "aaaaaaaaaa", "1111111111", "😂😂😂…"
  const racha = RE_RACHA.exec(crudo);
  if (racha) {
    return { tipo: "racha", muestra: racha[1], veces: [...racha[0]].length };
  }

  // 2) Un trocito repetido sin parar: "jajajajajaja", "123123123123123123".
  //    Se quitan los espacios para que "ja ja ja ja ja ja" también entre.
  const patron = RE_PATRON.exec(crudo.toLowerCase().replace(/\s+/g, ""));
  if (patron) {
    return {
      tipo: "patron",
      muestra: patron[1],
      veces: Math.floor(patron[0].length / patron[1].length)
    };
  }

  // 3) La misma palabra suelta muchas veces. Ahora entran también las de una
  //    sola letra o número ("a a a a a", "1 1 1 1 1"), que antes se colaban
  //    porque se pedía que la palabra tuviera más de una letra.
  const palabras = normalizar(texto).split(" ").filter(Boolean);
  if (palabras.length >= PALABRA_REPETIDA) {
    const cuenta = new Map();
    for (const p of palabras) cuenta.set(p, (cuenta.get(p) || 0) + 1);

    for (const [palabra, veces] of cuenta) {
      if (veces >= PALABRA_REPETIDA) return { tipo: "palabra", muestra: palabra, veces };
    }
  }

  return null;
}

/** Se queda por compatibilidad: solo la repetición de palabras. */
export function palabraRepetida(texto = "") {
  const r = repeticionInterna(texto);
  return r && r.tipo === "palabra" ? { palabra: r.muestra, veces: r.veces } : null;
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
 * @returns {{veces:number, borrar:boolean, sacar:boolean, palabra:string, tipoSpam:string}}
 */
export function apuntar(conn, chatId, numero, texto) {
  // Si al normalizar no queda nada (un mensaje de puros signos, por ejemplo)
  // se compara el original en crudo, para no dejar de contarlo.
  const limpio = normalizar(texto) ||
    String(texto || "").toLowerCase().replace(/\s+/g, " ").trim();

  if (!limpio) return { veces: 0, borrar: false, sacar: false, palabra: "", tipoSpam: "" };

  const ahora = Date.now();
  limpiarViejos(ahora);

  const clave = `${quienEs(conn)}|${chatId}|${DIGITS(numero)}`;
  const previo = cuentas.get(clave);

  // Algo repetido dentro del propio mensaje ya cuenta como spam, sin esperar
  // a que lo mande cuatro veces.
  const dentro = repeticionInterna(texto);

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
    tipoSpam: dentro ? dentro.tipo : (porRepetir ? "mensaje" : ""),
    palabra: dentro ? dentro.muestra : "",
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

    const motivo =
      r.tipoSpam === "racha"   ? `repetir "${r.palabra}" ${r.vecesPalabra} veces pegadas` :
      r.tipoSpam === "patron"  ? `repetir "${r.palabra}" ${r.vecesPalabra} veces sin parar` :
      r.tipoSpam === "palabra" ? `repetir "${r.palabra}" ${r.vecesPalabra} veces en un mensaje` :
                                 `mandar lo mismo ${r.veces} veces seguidas`;

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

export default {
  revisarSpam, apuntar, reiniciar, normalizar, repeticionInterna, palabraRepetida
};
