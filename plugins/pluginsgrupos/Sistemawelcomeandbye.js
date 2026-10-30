import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { getConfig } from '../../db.js';
import { mediaBuffer, mediaPath } from '../../libs/media.js';

// Cache global de admins por chat
const adminCache = {};

// Evita duplicados cuando Baileys dispara native + stub al mismo tiempo
const recentEvents = new Map();
const RECENT_EVENT_TTL_MS = 8000;

// ==== HELPERS LID/REAL ====
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function isActive(value) {
  const v = String(value ?? "").trim().toLowerCase();

  return (
    value === 1 ||
    value === true ||
    v === "1" ||
    v === "on" ||
    v === "true" ||
    v === "activar" ||
    v === "activado" ||
    v === "enabled" ||
    v === "enable" ||
    v === "si" ||
    v === "sí"
  );
}

async function getConfigSafe(chatId, key, fallback = 0) {
  try {
    const value = getConfig(chatId, key);

    if (value && typeof value.then === "function") {
      const resolved = await value;
      return resolved ?? fallback;
    }

    return value ?? fallback;
  } catch (e) {
    console.log(`⚠️ Error leyendo config ${key} para ${chatId}:`, e.message);
    return fallback;
  }
}

function safeJsonRead(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;

    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;

    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch (e) {
    console.log("⚠️ Error leyendo JSON:", file, e.message);
    return fallback;
  }
}

function tryParseJsonObject(value) {
  if (typeof value !== "string") return null;

  const clean = value.trim();
  if (!clean.startsWith("{") || !clean.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ✅ Convierte cualquier cosa a texto JID seguro.
// Soporta string, objeto de Baileys, JSON string, LID, JID real, pn, jid, id, phoneNumber, etc.
function getJidStr(obj) {
  if (!obj) return "";

  if (typeof obj === "string") {
    if (obj === "[object Object]") return "";

    const parsed = tryParseJsonObject(obj);
    if (parsed) return getJidStr(parsed);

    return obj;
  }

  if (typeof obj === "number") return String(obj);

  if (typeof obj === "object") {
    return String(
      obj.jid ||
      obj.phoneNumber ||
      obj.pn ||
      obj.id ||
      obj.lid ||
      obj.participant ||
      obj.user ||
      obj._serialized ||
      ""
    );
  }

  return "";
}

function cleanJid(jid = "") {
  jid = getJidStr(jid).trim();

  if (!jid) return "";

  if (jid.includes(":") && jid.includes("@s.whatsapp.net")) {
    const num = jid.split(":")[0].replace(/[^0-9]/g, "");
    return num ? `${num}@s.whatsapp.net` : jid;
  }

  return jid;
}

function jidNumber(jid = "") {
  const text = cleanJid(jid);
  return DIGITS(text.split(":")[0]);
}

function makeRealJid(number = "") {
  const n = DIGITS(number);
  return n ? `${n}@s.whatsapp.net` : "";
}

function getParticipantCandidates(value) {
  const out = [];

  function add(v) {
    const text = cleanJid(v);
    if (text && text !== "[object Object]" && !out.includes(text)) out.push(text);
  }

  if (!value) return out;

  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);

    if (parsed) {
      return getParticipantCandidates(parsed);
    }

    add(value);
    return out;
  }

  if (typeof value === "number") {
    add(value);
    return out;
  }

  if (typeof value === "object") {
    add(value.jid);
    add(value.phoneNumber);
    add(value.pn);
    add(value.id);
    add(value.lid);
    add(value.participant);
    add(value.user);
    add(value._serialized);

    const n = DIGITS(value.phoneNumber || value.pn || value.user || "");
    if (n) add(makeRealJid(n));
  }

  return out;
}

/** Si id es @lid y existe .jid o .phoneNumber real, usa el real */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (
        typeof v?.id === "string" &&
        v.id.endsWith("@lid") &&
        (
          typeof v?.jid === "string" ||
          typeof v?.phoneNumber === "string" ||
          typeof v?.pn === "string"
        )
      )
        ? cleanJid(v.jid || v.phoneNumber || v.pn)
        : cleanJid(getJidStr(v)),
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Con metadata y un JID real/LID/objeto → { realJid, lidJid, number } */
function resolveRealFromMeta(meta, anyJid) {
  const out = {
    realJid: null,
    lidJid: null,
    number: null
  };

  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const norm = lidParser(raw);

  const candidates = getParticipantCandidates(anyJid);

  // Resolver directo por candidates
  for (const c of candidates) {
    if (c.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(c);
      out.number = jidNumber(c);
    }

    if (c.endsWith("@lid")) {
      out.lidJid = c;
    }
  }

  // Resolver usando global.lidMap si existe
  try {
    if (global.lidMap instanceof Map) {
      for (const c of candidates) {
        const resolved = global.lidMap.get(c);

        if (resolved && String(resolved).endsWith("@s.whatsapp.net")) {
          out.realJid = cleanJid(resolved);
          out.number = jidNumber(resolved);
        }
      }
    }
  } catch {}

  // Buscar en metadata
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] || {};
    const rawIds = getParticipantCandidates(p);
    const normId = cleanJid(norm[i]?.id || "");

    const allIds = [
      ...rawIds,
      normId
    ].filter(Boolean);

    const match = candidates.some(c => allIds.includes(c));

    if (!match) continue;

    for (const id of allIds) {
      if (id.endsWith("@s.whatsapp.net")) {
        out.realJid = cleanJid(id);
        out.number = jidNumber(id);
      }

      if (id.endsWith("@lid")) {
        out.lidJid = id;
      }
    }

    if (typeof p?.jid === "string" && p.jid.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.jid);
      out.number = jidNumber(p.jid);
    }

    if (typeof p?.phoneNumber === "string" && p.phoneNumber.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.phoneNumber);
      out.number = jidNumber(p.phoneNumber);
    }

    if (typeof p?.pn === "string" && p.pn.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.pn);
      out.number = jidNumber(p.pn);
    }

    if (typeof p?.id === "string" && p.id.endsWith("@lid")) {
      out.lidJid = p.id;
    }

    break;
  }

  // Último fallback: extraer número de cualquier candidate
  if (!out.number) {
    for (const c of candidates) {
      const n = jidNumber(c);

      if (n) {
        out.number = n;

        if (!out.realJid && c.endsWith("@s.whatsapp.net")) {
          out.realJid = makeRealJid(n);
        }

        break;
      }
    }
  }

  return out;
}

function findParticipantInfo(meta, anyJid) {
  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const candidates = getParticipantCandidates(anyJid);

  for (const p of raw) {
    const ids = getParticipantCandidates(p);

    if (candidates.some(c => ids.includes(c))) {
      return p;
    }
  }

  return null;
}

function isOwnerNumber(number) {
  const clean = DIGITS(number);
  if (!clean) return false;

  if (typeof global.isOwner === "function") {
    try {
      if (global.isOwner(clean)) return true;
      if (global.isOwner(`${clean}@s.whatsapp.net`)) return true;
    } catch {}
  }

  return Array.isArray(global.owner) && global.owner.some(function(entry) {
    if (Array.isArray(entry)) {
      return entry.some(x => DIGITS(x) === clean);
    }

    return DIGITS(entry) === clean;
  });
}

async function getProfileUrl(conn, userJid, chatId, fallback) {
  const tries = [
    cleanJid(userJid),
    chatId
  ].filter(Boolean);

  for (const jid of tries) {
    try {
      const url = await conn.profilePictureUrl(jid, "image");
      if (url) return url;
    } catch {}
  }

  return fallback;
}

// Tarjeta de bienvenida/despedida: la imagen local (bienvenida.jpg o
// despedida.jpg) con la foto de perfil en un círculo arriba a la izquierda.
// Si la persona no tiene foto o falla canvas, se manda la imagen sola.
async function sendTarjeta(conn, chatId, fondoClave, perfilURL, caption, mentions) {
  let image;
  try {
    const fondo = await loadImage(mediaPath(fondoClave));
    const canvas = createCanvas(fondo.width, fondo.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(fondo, 0, 0);

    const avatar = perfilURL ? await loadImage(perfilURL).catch(() => null) : null;
    if (avatar) {
      const r = Math.round(fondo.height * 0.09);
      const cx = r + Math.round(fondo.height * 0.035);
      const cy = cx;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();

      // Aro azul neón como el de las imágenes
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#4fc3ff";
      ctx.shadowColor = "#00a8ff";
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.restore();
    }

    image = canvas.toBuffer("image/jpeg", { quality: 0.9 });
  } catch (e) {
    console.log("⚠️ Canvas de bienvenida falló, se manda la imagen sola:", e.message);
    image = mediaBuffer(fondoClave);
  }

  await conn.sendMessage(chatId, { image, caption, mentions });
}

// ==== FALLBACK PARA EVENTOS NUEVOS DE BAILEYS POR STUB ====

function parseStubParticipantParam(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);

    if (parsed) {
      return {
        id: cleanJid(parsed.id || ""),
        jid: cleanJid(parsed.jid || parsed.phoneNumber || parsed.pn || ""),
        phoneNumber: cleanJid(parsed.phoneNumber || parsed.jid || parsed.pn || ""),
        lid: cleanJid(parsed.lid || parsed.id || ""),
        admin: parsed.admin ?? null,
        raw: parsed
      };
    }

    return cleanJid(value);
  }

  if (typeof value === "object") {
    return {
      id: cleanJid(value.id || ""),
      jid: cleanJid(value.jid || value.phoneNumber || value.pn || ""),
      phoneNumber: cleanJid(value.phoneNumber || value.jid || value.pn || ""),
      lid: cleanJid(value.lid || value.id || ""),
      admin: value.admin ?? null,
      raw: value
    };
  }

  return cleanJid(value);
}

function stubActionToGroupAction(stubType, type = "") {
  const n = Number(stubType);
  const s = String(type || stubType || "").toLowerCase();

  if (n === 27 || s.includes("group_participant_add")) return "add";
  if (n === 28 || s.includes("group_participant_remove")) return "remove";
  if (n === 29 || s.includes("group_participant_promote")) return "promote";
  if (n === 30 || s.includes("group_participant_demote")) return "demote";

  return "";
}

function buildUpdateFromStubMessage(m = {}) {
  const chatId = cleanJid(m.key?.remoteJid || "");
  if (!chatId || !chatId.endsWith("@g.us")) return null;

  const action = stubActionToGroupAction(m.messageStubType, m.type);
  if (!action) return null;

  const params = Array.isArray(m.messageStubParameters)
    ? m.messageStubParameters
    : [];

  const participants = params
    .map(parseStubParticipantParam)
    .filter(Boolean)
    .filter(x => {
      if (typeof x === "string") {
        return x.endsWith("@s.whatsapp.net") || x.endsWith("@lid");
      }

      return (
        String(x.id || "").endsWith("@lid") ||
        String(x.lid || "").endsWith("@lid") ||
        String(x.jid || "").endsWith("@s.whatsapp.net") ||
        String(x.phoneNumber || "").endsWith("@s.whatsapp.net")
      );
    });

  if (!participants.length) return null;

  const author = cleanJid(
    m.key?.participant ||
    m.participant ||
    m.key?.participantPn ||
    m.key?.participantLid ||
    ""
  );

  return {
    id: chatId,
    action,
    participants,
    author,
    fromStub: true,
    stubType: m.messageStubType,
    stubRawType: m.type || ""
  };
}

function makeEventDedupKey(update = {}) {
  const chatId = cleanJid(update?.id || "");
  const action = String(update?.action || "").toLowerCase();

  const participants = Array.isArray(update?.participants)
    ? update.participants
    : [];

  const ids = participants.map(p => {
    const candidates = getParticipantCandidates(p);
    const preferred =
      candidates.find(x => x.endsWith("@s.whatsapp.net")) ||
      candidates.find(x => x.endsWith("@lid")) ||
      cleanJid(getJidStr(p)) ||
      JSON.stringify(p);

    return preferred;
  }).sort();

  return `${chatId}|${action}|${ids.join(",")}`;
}

function shouldSkipDuplicate(update = {}) {
  const key = makeEventDedupKey(update);
  const now = Date.now();

  for (const [k, t] of recentEvents.entries()) {
    if (now - t > RECENT_EVENT_TTL_MS) {
      recentEvents.delete(k);
    }
  }

  if (recentEvents.has(key)) {
    return true;
  }

  recentEvents.set(key, now);
  return false;
}

// ==== LÓGICA PRINCIPAL ====

async function handleGroupParticipantsUpdate(conn, update) {
  try {
    const chatId = cleanJid(update?.id || "");
    const action = String(update?.action || "").toLowerCase();

    if (!chatId || !chatId.endsWith("@g.us")) return;

    const participants = Array.isArray(update?.participants)
      ? update.participants
      : [];

    if (!participants.length) {
      console.log("⚠️ group-participants.update sin participants:", update);
      return;
    }

    if (!["add", "remove", "promote", "demote"].includes(action)) {
      return;
    }

    if (shouldSkipDuplicate(update)) {
      console.log("♻️ Evento duplicado ignorado:", action, chatId);
      return;
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(update?.fromStub ? "🧩 EVENTO DE PARTICIPANTES POR STUB" : "👥 EVENTO DE PARTICIPANTES");
    console.log("➡️ Grupo:", chatId);
    console.log("➡️ Acción:", action);
    console.log("➡️ Participantes:", participants.length);

    if (update?.fromStub) {
      console.log("➡️ StubType:", update.stubType);
      console.log("➡️ Tipo:", update.stubRawType || "N/A");
    }

    const metadata = await conn.groupMetadata(chatId).catch((e) => {
      console.log("⚠️ No se pudo leer metadata del grupo:", e.message);
      return null;
    });

    if (!metadata) return;

    // Actualizar Cache de Admins Inicial
    if (!adminCache[chatId]) {
      adminCache[chatId] = new Set(
        metadata.participants
          .filter(p => p.admin === "admin" || p.admin === "superadmin")
          .map(p => cleanJid(getJidStr(p)))
          .filter(Boolean)
      );
    }

    const welcomeActive = await getConfigSafe(chatId, "welcome", 0);
    const byeActive = await getConfigSafe(chatId, "despedidas", 0);
    const antiArabe = await getConfigSafe(chatId, "antiarabe", 0);

    console.log("⚙️ Config welcome:", welcomeActive);
    console.log("⚙️ Config despedidas:", byeActive);
    console.log("⚙️ Config antiarabe:", antiArabe);

    const setwelcomePath = path.resolve("setwelcome.json");
    const setwelcomeData = safeJsonRead(setwelcomePath, {});
    const personalizados = setwelcomeData[chatId] || {};

    const bienvenidaPersonalizada = personalizados?.bienvenida;
    const despedidaPersonalizada = personalizados?.despedida;

    const mensajesBienvenida = [
      "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
      "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía✨️",
      "✨ ¡Nuevo miembro ha llegado! Que empiece la fiesta 🎊",
      "😯 ¡Hey! Te damos la bienvenida con los brazos abiertos🤗",
      "💥 ¡Un guerrero más se une a la aventura! Bienvenid@ 😎"
    ];

    const mensajesDespedida = [
      "😈 ¡Adiós! Esperamos de nuevo.",
      "😆 Se ha ido un miembro. ¡Buena suerte!",
      "🚪 Alguien ha salido del grupo. ¡Hasta luego!",
      "📤 Un compañero ha partido, ¡le deseamos lo mejor!",
      "💨 Se ha ido volando... ¡Bye bye!"
    ];

    const arabes = [
      "20", "212", "213", "216", "218", "222", "224", "230", "234", "235", "237", "238", "249",
      "250", "251", "252", "253", "254", "255", "257", "258", "260", "263", "269", "960", "961",
      "962", "963", "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975",
      "976", "980", "981", "992", "994", "995", "998"
    ];

    // 🔰 SISTEMA DE AVISO DE CAMBIOS DE ADMIN
    if (action === "promote" || action === "demote") {
      const actor = cleanJid(update?.author || update?.authorPn || "");
      const actorNum = actor ? DIGITS(actor) : "Desconocido";
      const actorMention = actor || null;

      for (const targetRaw of participants) {
        const target = cleanJid(getJidStr(targetRaw));
        const resolved = resolveRealFromMeta(metadata, targetRaw);
        const targetMention = resolved.realJid || resolved.lidJid || target;
        const targetNum = resolved.number || jidNumber(targetMention) || "Desconocido";

        if (!targetMention) continue;

        const mencionesEfectivas = [
          targetMention,
          actorMention
        ].filter(Boolean).map(String);

        if (action === "promote") {
          const texto =
`╭──『 👑 *NUEVO ADMIN* 』─◆
│ 👤 Usuario: @${targetNum}
│ ✅ Ascendido por: @${actorNum}
╰────────────────────◆`;

          await conn.sendMessage(chatId, {
            text: texto,
            mentions: mencionesEfectivas
          });

          console.log("✅ Aviso promote enviado:", targetMention);
        }

        if (action === "demote") {
          const texto =
`╭──『 📉 *ADMIN DEGRADADO* 』─◆
│ 👤 Usuario: @${targetNum}
│ ❌ Degradado por: @${actorNum}
╰────────────────────◆`;

          await conn.sendMessage(chatId, {
            text: texto,
            mentions: mencionesEfectivas
          });

          console.log("✅ Aviso demote enviado:", targetMention);
        }
      }

      return;
    }

    // 🔄 SISTEMA DE BIENVENIDAS, DESPEDIDAS Y ANTIÁRABE
    for (const pRaw of participants) {
      const participant = cleanJid(getJidStr(pRaw));
      const resolved = resolveRealFromMeta(metadata, pRaw);

      const mentionId = String(
        resolved.realJid ||
        resolved.lidJid ||
        participant ||
        ""
      );

      if (!mentionId) {
        console.log("⚠️ Participante sin JID válido. Ignorado:", pRaw);
        continue;
      }

      const phoneForMention =
        resolved.number ||
        jidNumber(mentionId) ||
        DIGITS(participant) ||
        "usuario";

      const mention = phoneForMention === "usuario"
        ? "@usuario"
        : `@${phoneForMention}`;

      if (action === "add") {
        const isArabic =
          isActive(antiArabe) &&
          resolved.number &&
          arabes.some(cc => resolved.number.startsWith(cc));

        if (isArabic) {
          const info = findParticipantInfo(metadata, pRaw);
          const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
          const isOwner = isOwnerNumber(resolved.number);

          if (!isAdmin && !isOwner) {
            await conn.sendMessage(chatId, {
              text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
              mentions: [mentionId]
            });

            try {
              await conn.groupParticipantsUpdate(chatId, [mentionId], "remove");
            } catch (e1) {
              try {
                if (participant && participant !== mentionId) {
                  await conn.groupParticipantsUpdate(chatId, [participant], "remove");
                }
              } catch (e2) {
                console.log("⚠️ No se pudo expulsar antiárabe:", e2.message);
              }
            }

            continue;
          }
        }

        if (!isActive(welcomeActive)) {
          console.log("ℹ️ Welcome apagado para:", chatId);
          continue;
        }

        const perfilURL = await getProfileUrl(
          conn,
          resolved.realJid || mentionId,
          chatId,
          null
        );

        if (bienvenidaPersonalizada) {
          await conn.sendMessage(chatId, {
            image: perfilURL ? { url: perfilURL } : mediaBuffer("bienvenida"),
            caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
          await sendTarjeta(
            conn,
            chatId,
            "bienvenida",
            perfilURL,
            `👋 ${mention}\n\n${mensaje}`,
            [mentionId]
          );
        }

        console.log("✅ Bienvenida enviada a:", mentionId);
      }

      if (action === "remove") {
        if (!isActive(byeActive)) {
          console.log("ℹ️ Despedidas apagado para:", chatId);
          continue;
        }

        const perfilURL = await getProfileUrl(
          conn,
          resolved.realJid || mentionId,
          chatId,
          null
        );

        if (despedidaPersonalizada) {
          await conn.sendMessage(chatId, {
            image: perfilURL ? { url: perfilURL } : mediaBuffer("despedida"),
            caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
          await sendTarjeta(
            conn,
            chatId,
            "despedida",
            perfilURL,
            `👋 ${mention}\n\n${mensaje}`,
            [mentionId]
          );
        }

        console.log("✅ Despedida enviada a:", mentionId);
      }
    }

    // Actualizar Cache de Admins Final
    const newMeta = await conn.groupMetadata(chatId).catch(() => null);

    if (newMeta) {
      adminCache[chatId] = new Set(
        newMeta.participants
          .filter(p => p.admin === "admin" || p.admin === "superadmin")
          .map(p => cleanJid(getJidStr(p)))
          .filter(Boolean)
      );
    }

  } catch (err) {
    console.error("❌ Error en lógica de grupo:", err);
  }
}

const handler = async (conn) => {
  if (!conn?.ev?.on) {
    console.log("❌ Welcome/despedidas: conn.ev.on no disponible.");
    return;
  }

  // Evita registrar el listener muchas veces si el loader recarga plugins
  if (conn.__sukiWelcomeOldListenerStarted) {
    console.log("♻️ Listener viejo de bienvenidas/despedidas ya estaba activo.");
    return;
  }

  conn.__sukiWelcomeOldListenerStarted = true;

  // Listener normal de Baileys
  conn.ev.on("group-participants.update", async (update) => {
    await handleGroupParticipantsUpdate(conn, update);
  });

  // Fallback nuevo: algunos Baileys ahora mandan add/remove/promote/demote como messageStubType en messages.upsert
  conn.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const m of messages || []) {
        const fakeUpdate = buildUpdateFromStubMessage(m);
        if (!fakeUpdate) continue;

        await handleGroupParticipantsUpdate(conn, fakeUpdate);
      }
    } catch (e) {
      console.log("❌ Error en fallback messages.upsert para participantes:", e.message);
    }
  });

  console.log("✅ Listener viejo de bienvenidas/despedidas cargado correctamente.");
  console.log("✅ Fallback de eventos por messageStubType activado correctamente.");
};

handler.run = handler;
export default handler;
