// subplugins/grupos/sistemawelcome.js
// Sistema de bienvenidas y despedidas para SUBBOTS (adaptado de
// plugins/pluginsgrupos/Sistemawelcomeandbye.js del bot principal).
// Cada subbot guarda SU PROPIA configuración en:
//   subbots/data/<numero>/welcome.json
// Estructura: { "<grupo@g.us>": { welcome: 1, despedidas: 1, bienvenida: "...", despedida: "..." } }
import { createCanvas, loadImage } from 'canvas';

// Evita duplicados cuando Baileys dispara native + stub al mismo tiempo
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
    v === "si" ||
    v === "sí"
  );
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

function getParticipantCandidates(value) {
  const out = [];
  function add(v) {
    const text = cleanJid(v);
    if (text && text !== "[object Object]" && !out.includes(text)) out.push(text);
  }
  if (!value) return out;
  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);
    if (parsed) return getParticipantCandidates(parsed);
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
  }
  return out;
}

/** Con metadata y un JID real/LID/objeto → { realJid, lidJid, number } */
function resolveRealFromMeta(meta, anyJid) {
  const out = { realJid: null, lidJid: null, number: null };
  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const candidates = getParticipantCandidates(anyJid);

  for (const c of candidates) {
    if (c.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(c);
      out.number = jidNumber(c);
    }
    if (c.endsWith("@lid")) out.lidJid = c;
  }

  for (const p of raw) {
    const ids = getParticipantCandidates(p);
    const match = candidates.some(c => ids.includes(c));
    if (!match) continue;
    for (const id of ids) {
      if (id.endsWith("@s.whatsapp.net")) {
        out.realJid = cleanJid(id);
        out.number = jidNumber(id);
      }
      if (id.endsWith("@lid")) out.lidJid = id;
    }
    break;
  }

  if (!out.number) {
    for (const c of candidates) {
      const n = jidNumber(c);
      if (n) {
        out.number = n;
        break;
      }
    }
  }

  return out;
}

async function getProfileUrl(conn, userJid, chatId, fallback) {
  const tries = [cleanJid(userJid), chatId].filter(Boolean);
  for (const jid of tries) {
    try {
      const url = await conn.profilePictureUrl(jid, "image");
      if (url) return url;
    } catch {}
  }
  return fallback;
}

async function loadImageSafe(url, fallbackUrl) {
  try {
    return await loadImage(url);
  } catch {
    return await loadImage(fallbackUrl);
  }
}

async function sendCanvasImage(conn, chatId, perfilURL, fondoUrl, fallbackAvatar, caption, mentions) {
  try {
    const avatar = await loadImageSafe(perfilURL, fallbackAvatar);
    const fondo = await loadImage(fondoUrl);

    const canvas = createCanvas(1080, 720);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(fondo, 0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(150, 150, 85, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(avatar, 65, 65, 170, 170);
    ctx.restore();
    ctx.globalAlpha = 1.0;

    await conn.sendMessage(chatId, {
      image: Buffer.from(canvas.toBuffer("image/png")),
      caption,
      mentions
    });
  } catch {
    // Fallback sin canvas
    await conn.sendMessage(chatId, {
      image: { url: perfilURL || fallbackAvatar },
      caption,
      mentions
    }).catch(() => {});
  }
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
  return "";
}

function buildUpdateFromStubMessage(m = {}) {
  const chatId = cleanJid(m.key?.remoteJid || "");
  if (!chatId || !chatId.endsWith("@g.us")) return null;

  const action = stubActionToGroupAction(m.messageStubType, m.type);
  if (!action) return null;

  const params = Array.isArray(m.messageStubParameters) ? m.messageStubParameters : [];
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

  return { id: chatId, action, participants, fromStub: true };
}

function makeEventDedupKey(update = {}) {
  const chatId = cleanJid(update?.id || "");
  const action = String(update?.action || "").toLowerCase();
  const participants = Array.isArray(update?.participants) ? update.participants : [];
  const ids = participants.map(p => {
    const candidates = getParticipantCandidates(p);
    return (
      candidates.find(x => x.endsWith("@s.whatsapp.net")) ||
      candidates.find(x => x.endsWith("@lid")) ||
      cleanJid(getJidStr(p)) ||
      JSON.stringify(p)
    );
  }).sort();
  return `${chatId}|${action}|${ids.join(",")}`;
}

// ==== LÓGICA PRINCIPAL ====
async function handleGroupParticipantsUpdate(conn, update, recentEvents) {
  try {
    const chatId = cleanJid(update?.id || "");
    const action = String(update?.action || "").toLowerCase();

    if (!chatId || !chatId.endsWith("@g.us")) return;
    if (!["add", "remove"].includes(action)) return;

    const participants = Array.isArray(update?.participants) ? update.participants : [];
    if (!participants.length) return;

    // Configuración PROPIA de este subbot
    const welcomeData = conn.readSubData ? conn.readSubData("welcome.json", {}) : {};
    const grupoCfg = welcomeData[chatId] || {};

    const welcomeActive = isActive(grupoCfg.welcome);
    const byeActive = isActive(grupoCfg.despedidas);
    const antiArabe = typeof conn.getSubConfig === "function"
      ? isActive(conn.getSubConfig(chatId, "antiarabe"))
      : false;

    if (action === "add" && !welcomeActive && !antiArabe) return;
    if (action === "remove" && !byeActive) return;

    // Dedupe de eventos (native + stub)
    const key = makeEventDedupKey(update);
    const now = Date.now();
    for (const [k, t] of recentEvents.entries()) {
      if (now - t > RECENT_EVENT_TTL_MS) recentEvents.delete(k);
    }
    if (recentEvents.has(key)) return;
    recentEvents.set(key, now);

    const metadata = await conn.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    const bienvenidaPersonalizada = grupoCfg.bienvenida;
    const despedidaPersonalizada = grupoCfg.despedida;

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

    for (const pRaw of participants) {
      const participant = cleanJid(getJidStr(pRaw));
      const resolved = resolveRealFromMeta(metadata, pRaw);

      const mentionId = String(resolved.realJid || resolved.lidJid || participant || "");
      if (!mentionId) continue;

      const phoneForMention =
        resolved.number || jidNumber(mentionId) || DIGITS(participant) || "usuario";
      const mention = phoneForMention === "usuario" ? "@usuario" : `@${phoneForMention}`;

      if (action === "add") {
        // 🚷 Antiárabe (mismo listado de prefijos que el bot principal)
        if (antiArabe && resolved.number) {
          const arabes = [
            "20", "212", "213", "216", "218", "222", "224", "230", "234", "235", "237", "238", "249",
            "250", "251", "252", "253", "254", "255", "257", "258", "260", "263", "269", "960", "961",
            "962", "963", "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975",
            "976", "980", "981", "992", "994", "995", "998"
          ];
          if (arabes.some(cc => resolved.number.startsWith(cc))) {
            await conn.sendMessage(chatId, {
              text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
              mentions: [mentionId]
            }).catch(() => {});
            try {
              await conn.groupParticipantsUpdate(chatId, [mentionId], "remove");
            } catch {
              try {
                if (participant && participant !== mentionId) {
                  await conn.groupParticipantsUpdate(chatId, [participant], "remove");
                }
              } catch {}
            }
            continue;
          }
        }

        if (!welcomeActive) continue;

        const perfilURL = await getProfileUrl(
          conn,
          resolved.realJid || mentionId,
          chatId,
          "https://cdn.russellxz.click/e72cc417.jpeg"
        );

        if (bienvenidaPersonalizada) {
          await conn.sendMessage(chatId, {
            image: { url: perfilURL },
            caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
          await sendCanvasImage(
            conn,
            chatId,
            perfilURL,
            "https://cdn.russellxz.click/7177383b.jpg",
            "https://cdn.russellxz.click/e72cc417.jpeg",
            `👋 ${mention}\n\n${mensaje}\n\n🤖 Suki Subbots`,
            [mentionId]
          );
        }
      }

      if (action === "remove") {
        const perfilURL = await getProfileUrl(
          conn,
          resolved.realJid || mentionId,
          chatId,
          "https://cdn.russellxz.click/7177383b.jpg"
        );

        if (despedidaPersonalizada) {
          await conn.sendMessage(chatId, {
            image: { url: perfilURL },
            caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
          await sendCanvasImage(
            conn,
            chatId,
            perfilURL,
            "https://cdn.russellxz.click/bc842c44.jpg",
            "https://cdn.russellxz.click/7177383b.jpg",
            `👋 ${mention}\n\n${mensaje}\n\n🤖 Suki Subbots`,
            [mentionId]
          );
        }
      }
    }
  } catch (err) {
    console.error("❌ [subbot] Error en bienvenidas/despedidas:", err);
  }
}

const handler = async (conn) => {
  if (!conn?.ev?.on) return;
  if (conn.__subWelcomeListenerStarted) return;
  conn.__subWelcomeListenerStarted = true;

  const recentEvents = new Map();

  conn.ev.on("group-participants.update", async (update) => {
    await handleGroupParticipantsUpdate(conn, update, recentEvents);
  });

  // Fallback: eventos add/remove que llegan como messageStubType
  conn.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const m of messages || []) {
        const fakeUpdate = buildUpdateFromStubMessage(m);
        if (!fakeUpdate) continue;
        await handleGroupParticipantsUpdate(conn, fakeUpdate, recentEvents);
      }
    } catch {}
  });
};

handler.run = handler;
export default handler;
