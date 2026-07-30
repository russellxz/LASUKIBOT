/**
 * adminCheck.js — Detección robusta de admin/owner para grupos LID y normales
 * Uso: import { isAdminInGroup, isOwnerCheck } from '../libs/adminCheck.js';
 */

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

/**
 * Extrae todos los números posibles de un JID/string para comparación flexible.
 */
function extractNumbers(value) {
  const nums = new Set();
  if (!value) return nums;

  const s = String(value);
  const main = JID_NUM(s);
  if (main) {
    nums.add(main);
    // variante con 0 al final (números peruanos/latinoam)
    if (!main.endsWith("0")) nums.add(main + "0");
    // variante sin 0 al final
    if (main.endsWith("0")) nums.add(main.slice(0, -1));
  }
  return nums;
}

/**
 * Verifica si dos JIDs/números corresponden al mismo participante.
 * Compara por dígitos, resuelve LID via lidMap global si está disponible.
 */
function sameParticipant(a, b) {
  if (!a || !b) return false;
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return true;

  const na = JID_NUM(sa);
  const nb = JID_NUM(sb);
  if (na && nb && na === nb) return true;

  // variantes con/sin cero
  const numsA = extractNumbers(sa);
  const numsB = extractNumbers(sb);
  for (const n of numsA) {
    if (numsB.has(n)) return true;
  }

  // resolución LID ↔ real via lidMap global
  if (global.lidMap instanceof Map) {
    const resolvedA = global.lidMap.get(sa) || global.lidMap.get(na ? `${na}@lid` : "") || global.lidMap.get(na ? `${na}@s.whatsapp.net` : "");
    if (resolvedA) {
      const rn = JID_NUM(String(resolvedA));
      if (rn && numsB.has(rn)) return true;
    }
    const resolvedB = global.lidMap.get(sb) || global.lidMap.get(nb ? `${nb}@lid` : "") || global.lidMap.get(nb ? `${nb}@s.whatsapp.net` : "");
    if (resolvedB) {
      const rn = JID_NUM(String(resolvedB));
      if (rn && numsA.has(rn)) return true;
    }
  }

  return false;
}

/**
 * Verifica si un JID/número es admin en el grupo dado.
 * @param {object} conn - conexión Baileys
 * @param {string} chatId - JID del grupo
 * @param {string} senderJid - JID o número del remitente (puede ser @lid o @s.whatsapp.net)
 * @returns {Promise<boolean>}
 */
export async function isAdminInGroup(conn, chatId, senderJid) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];

    for (const p of participants) {
      const isAdmin = p?.admin === "admin" || p?.admin === "superadmin";
      if (!isAdmin) continue;

      // Comparar p.id directamente
      if (sameParticipant(p.id, senderJid)) return true;

      // Comparar p.jid si existe (algunos clientes Baileys lo incluyen)
      if (p.jid && sameParticipant(p.jid, senderJid)) return true;

      // Si p.id es @lid, intentar resolver
      if (typeof p.id === "string" && p.id.endsWith("@lid") && global.lidMap instanceof Map) {
        const resolved = global.lidMap.get(p.id);
        if (resolved && sameParticipant(resolved, senderJid)) return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Verifica si un NÚMERO es admin del grupo.
 *
 * Es la misma lógica que usan .abrir y .cerrar, que sí acierta con las cuentas
 * que WhatsApp entrega como @lid. La diferencia con isAdminInGroup está en el
 * tercer intento: cuando el participante viene en @lid y el lidMap global
 * todavía no lo tiene cacheado, se pregunta a conn.lidParser. Sin ese paso, a
 * un admin con LID el bot lo trataba como si no lo fuera.
 *
 * @param {object} conn    conexión Baileys
 * @param {string} chatId  JID del grupo
 * @param {string} number  número ya normalizado (solo dígitos)
 * @returns {Promise<boolean>}
 */
export async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

    const adminNums = new Set();

    for (let i = 0; i < rawParts.length; i++) {
      const p = rawParts[i];
      const flagAdmin = p.admin === "admin" || p.admin === "superadmin";
      if (!flagAdmin) continue;

      const pid = String(p.id || "");
      const pjid = String(p.jid || "");

      // 1) el número viene tal cual
      if (pid.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(pid.split(":")[0]));
      if (pjid.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(pjid.split(":")[0]));

      // 2) viene en @lid: se busca en el mapa global
      if (pid.endsWith("@lid") && global.lidMap instanceof Map) {
        const resolved = global.lidMap.get(pid);
        if (resolved && resolved.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(resolved.split(":")[0]));
      }
      if (pjid.endsWith("@lid") && global.lidMap instanceof Map) {
        const resolved2 = global.lidMap.get(pjid);
        if (resolved2 && resolved2.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(resolved2.split(":")[0]));
      }

      // 3) el mapa no lo tenía: se lo preguntamos a Baileys
      if (typeof conn.lidParser === "function") {
        const normed = conn.lidParser([p]);
        if (normed && normed[0]) {
          const nid = String(normed[0].id || "");
          if (nid.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(nid.split(":")[0]));
        }
      }
    }

    return adminNums.has(String(number));
  } catch (e) {
    console.error("[adminCheck] Error leyendo admins:", e);
    return false;
  }
}

/**
 * Saca el número del remitente igual que lo hacen .abrir y .cerrar.
 * @returns {string} solo dígitos
 */
export function numeroDelRemitente(msg) {
  const senderId = msg?.realJid || msg?.key?.participant || msg?.key?.remoteJid || "";
  return String(msg?.realNumber || DIGITS(String(senderId).split(":")[0]));
}

/**
 * Verifica si un JID/número es owner del bot.
 * @param {string} senderJid
 * @returns {boolean}
 */
export function isOwnerCheck(senderJid) {
  try {
    if (!senderJid) return false;
    const sNum = JID_NUM(senderJid);
    const sNums = extractNumbers(senderJid);

    // via función global
    if (typeof global.isOwner === "function") {
      if (global.isOwner(senderJid)) return true;
      if (sNum && global.isOwner(sNum)) return true;
      if (sNum && global.isOwner(`${sNum}@s.whatsapp.net`)) return true;
    }

    // via array global.owner
    if (Array.isArray(global.owner)) {
      for (const entry of global.owner) {
        const candidates = Array.isArray(entry) ? entry : [entry];
        for (const c of candidates) {
          const cn = JID_NUM(String(c || ""));
          if (cn && sNums.has(cn)) return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Helper completo para plugins: retorna { isAdmin, isOwner, fromMe }
 * @param {object} conn
 * @param {object} msg
 * @returns {Promise<{ isAdmin: boolean, isOwner: boolean, fromMe: boolean, senderJid: string }>}
 */
export async function getSenderPerms(conn, msg) {
  const fromMe = !!msg.key?.fromMe;
  const chatId = msg.key?.remoteJid || "";
  const isGroup = chatId.endsWith("@g.us");

  // Preferir msg.realJid (ya normalizado por index.js), sino participant, sino remoteJid
  const senderJid = msg.realJid || msg.key?.participant || (fromMe ? (conn.user?.id || "") : chatId);

  if (!isGroup) {
    return { isAdmin: false, isOwner: isOwnerCheck(senderJid), fromMe, senderJid };
  }

  const [isAdmin, isOwner] = await Promise.all([
    isAdminInGroup(conn, chatId, senderJid),
    Promise.resolve(isOwnerCheck(senderJid))
  ]);

  return { isAdmin, isOwner, fromMe, senderJid };
}
