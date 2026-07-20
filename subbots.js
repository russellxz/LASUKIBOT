// ============================================================
// 🤖 SUBBOTS.JS — Núcleo del sistema de Subbots de La Suki
// ============================================================
// Sistema independiente del bot principal:
//  - Sesiones propias:   ./subbots/sessions/<numero>/
//  - Datos propios:      ./subbots/data/<numero>/  (config, grupos, lista, welcome — todo .json)
//  - Plugins propios:    ./subplugins/  (carpeta de comandos independiente)
//  - Auto-reconexión con backoff, limpieza de sesión al desvincular,
//    tiempo de conexión persistido en .json (sobrevive reinicios).
//  - Optimizado para cientos de subbots: logger silencioso, versión de WA
//    cacheada, arranque escalonado y plugins cargados UNA sola vez en memoria.
// ============================================================

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import pino from "pino";
import chalk from "chalk";

const SUB_ROOT = path.resolve("./subbots");
const SESSIONS_DIR = path.join(SUB_ROOT, "sessions");
const DATA_DIR = path.join(SUB_ROOT, "data");
const PLUGINS_DIR = path.resolve("./subplugins");

export const DEFAULT_SUB_PREFIXES = [".", "#", "/"];
const MENU_IMAGE = "https://cdn.russellxz.click/c678c800.jpg";
const CODE_VIDEO = "https://cdn.russellxz.click/76b170f5.mp4";

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// Registro en memoria: numero -> { sock, status, attempts, stopped, opts, pairingTimer, reconnectTimer }
const subbots = new Map();

let baileysMod = null;
let cachedVersion = null;
let subPluginsPromise = null;

const silentLogger = pino({ level: "silent" });

// ------------------------------------------------------------
// Utilidades de archivos JSON
// ------------------------------------------------------------
function ensureDirs() {
  for (const d of [SUB_ROOT, SESSIONS_DIR, DATA_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

export function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Caché en memoria (TTL) para lecturas frecuentes: evita golpear el disco
// en cada mensaje cuando hay cientos de subbots conectados.
const jsonCache = new Map(); // file -> { data, ts }
const JSON_CACHE_TTL = 10000;

function readJsonCached(file, fallback) {
  const hit = jsonCache.get(file);
  if (hit && Date.now() - hit.ts < JSON_CACHE_TTL) return hit.data;
  const data = readJson(file, fallback);
  jsonCache.set(file, { data, ts: Date.now() });
  return data;
}

export function writeJson(file, data) {
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    jsonCache.delete(file); // invalidar caché al escribir
  } catch (e) {
    console.error(chalk.red(`[subbots] Error escribiendo ${file}:`), e.message);
  }
}

export function subDataDir(number) {
  ensureDirs();
  const dir = path.join(DATA_DIR, DIGITS(number));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function subSessionDir(number) {
  ensureDirs();
  return path.join(SESSIONS_DIR, DIGITS(number));
}

// ------------------------------------------------------------
// Flag de "hosting de subbots": permite que OTROS usuarios (no el dueño)
// se conecten como subbots a este bot principal. Se controla desde el
// panel web. Guardado en ./subbot_hosting.json en la raíz del bot.
// ------------------------------------------------------------
const HOSTING_FILE = path.resolve("./subbot_hosting.json");

export function getSubbotHosting() {
  const data = readJson(HOSTING_FILE, null);
  // Por defecto DESACTIVADO: el dueño elige si activarlo desde el panel web.
  if (!data || typeof data.enabled === "undefined") return false;
  return !!data.enabled;
}

export function setSubbotHosting(enabled) {
  writeJson(HOSTING_FILE, { enabled: !!enabled, updatedAt: Date.now() });
  return !!enabled;
}

export function getSubConfig(number) {
  const file = path.join(subDataDir(number), "config.json");
  const cfg = readJson(file, {});
  if (!Array.isArray(cfg.prefixes) || !cfg.prefixes.length) cfg.prefixes = [...DEFAULT_SUB_PREFIXES];
  if (typeof cfg.connectedSince === "undefined") cfg.connectedSince = null;
  if (typeof cfg.welcomed === "undefined") cfg.welcomed = false;
  return cfg;
}

export function saveSubConfig(number, cfg) {
  writeJson(path.join(subDataDir(number), "config.json"), cfg);
}

// ------------------------------------------------------------
// 🚀 Caché de listas de dispositivos COMPARTIDA entre el bot principal
// y todos los subbots (son datos globales de WhatsApp: usuario → sus
// dispositivos, iguales para cualquier bot). El default de Baileys expira
// cada 5 min y cada expiración cuesta una consulta de red (~100ms) en el
// siguiente envío. Es seguro alargarla: Baileys la invalida sola cuando
// WhatsApp notifica cambios de dispositivos.
// ------------------------------------------------------------
function getDeviceListCache() {
  if (!global.__deviceListCache) {
    const dlStore = new Map();
    const DL_TTL = 60 * 60 * 1000; // 1 hora
    global.__deviceListCache = {
      get(k) {
        const e = dlStore.get(k);
        if (!e) return undefined;
        if (Date.now() > e.exp) { dlStore.delete(k); return undefined; }
        return e.v;
      },
      set(k, v) {
        dlStore.set(k, { v, exp: Date.now() + DL_TTL });
        if (dlStore.size > 10000) dlStore.delete(dlStore.keys().next().value);
      },
      mget(keys) {
        const out = {};
        for (const k of keys || []) {
          const v = this.get(k);
          if (v !== undefined) out[k] = v;
        }
        return out;
      },
      mset(entries) {
        for (const { key, value } of entries || []) this.set(key, value);
      },
      del(k) { dlStore.delete(k); },
      flushAll() { dlStore.clear(); }
    };
  }
  return global.__deviceListCache;
}

// ------------------------------------------------------------
// Baileys (import dinámico compatible CJS/ESM, cacheado)
// ------------------------------------------------------------
async function getBaileys() {
  if (baileysMod) return baileysMod;
  const mod = await import("@whiskeysockets/baileys");
  baileysMod = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;
  return baileysMod;
}

async function getWaVersion(B) {
  if (cachedVersion) return cachedVersion;
  try {
    const fn =
      typeof B.fetchLatestWaWebVersion === "function"
        ? B.fetchLatestWaWebVersion
        : B.fetchLatestBaileysVersion;
    const { version } = await fn();
    cachedVersion = version;
  } catch {
    cachedVersion = undefined;
  }
  return cachedVersion;
}

// ------------------------------------------------------------
// Plugins de subbots (se cargan UNA vez y se comparten en memoria)
// ------------------------------------------------------------
async function loadDirRecursively(dir, list) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      await loadDirRecursively(fullPath, list);
    } else if (item.isFile() && item.name.endsWith(".js")) {
      try {
        const mod = await import(pathToFileURL(path.resolve(fullPath)).href);
        const plugin = mod.default || mod;
        list.push(plugin);
        console.log(chalk.green(`✅ [subbots] Plugin cargado: ${fullPath}`));
      } catch (err) {
        console.log(chalk.red(`❌ [subbots] Error al cargar ${fullPath}: ${err}`));
      }
    }
  }
}

export async function loadSubPlugins() {
  if (!subPluginsPromise) {
    subPluginsPromise = (async () => {
      const list = [];
      await loadDirRecursively(PLUGINS_DIR, list);
      global.subPlugins = list;

      // Índice comando → plugin para despacho O(1) (el primero que registra
      // un comando gana, igual que el orden de carga del bot principal)
      const index = new Map();
      for (const plugin of list) {
        const cmds = Array.isArray(plugin?.command) ? plugin.command : [];
        for (const c of cmds) {
          const key = String(c).toLowerCase();
          if (!index.has(key)) index.set(key, plugin);
        }
      }
      global.subPluginIndex = index;

      console.log(chalk.cyan(`🧩 [subbots] ${list.length} plugins de subbots cargados (${index.size} comandos).`));
      return list;
    })();
  }
  return subPluginsPromise;
}

// ------------------------------------------------------------
// Mensaje de instrucciones que el subbot se envía a sí mismo
// ------------------------------------------------------------
function buildInstructions(number) {
  const cfg = getSubConfig(number);
  const p = cfg.prefixes[0] || ".";
  return `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

🎉 *¡Bienvenido al sistema de Subbots de La Suki!*
Tu número ya está conectado como *subbot* ✅

📌 *Prefijos por defecto:* .  #  /
(Puedes cambiarlos con *${p}setprefix*)

━━━━━━━━━━━━━━━━━━
🔐 *¿A QUIÉN RESPONDE TU SUBBOT?*
━━━━━━━━━━━━━━━━━━
Por seguridad, tu subbot SOLO te responde a ti:
• En tu chat privado (tú mismo).
• En cualquier grupo, pero solo a ti.

Para que responda a más personas usa:

👥 *${p}addgrupo* → úsalo DENTRO de un grupo para
que el subbot responda a *todos* los miembros de
ese grupo. Se guarda en una lista (.json).
✖️ *${p}delgrupo* → saca el grupo de la lista.

📱 *${p}addlista +507xxxxxxx* → agrega el número de
un usuario para que el subbot le responda en
*privado*. Solo tú puedes usar este comando.
✖️ *${p}dellista +507xxxxxxx* → lo quita de la lista.

━━━━━━━━━━━━━━━━━━
⚙️ *OTROS COMANDOS ÚTILES*
━━━━━━━━━━━━━━━━━━
🔧 *${p}setprefix* → cambia tu prefijo.
   Ej: ${p}setprefix 🐱  o  ${p}setprefix [ "." , "#" ]
📖 *${p}menu* → ver todos los comandos disponibles.
🤖 *${p}bots* → ver subbots conectados y su tiempo activo.
🔗 *${p}code +507xxxxxxx* → conecta a otra persona
   como subbot desde tu propio subbot.

🎉 *Bienvenidas y despedidas en tus grupos:*
• *${p}welcome on/off* → activa/desactiva bienvenidas.
• *${p}despedidas on/off* → activa/desactiva despedidas.
• *${p}setwelcome <texto>* → bienvenida personalizada.
• *${p}setdespedidas <texto>* → despedida personalizada.
• *${p}delwelcome* → borra los textos personalizados.

━━━━━━━━━━━━━━━━━━
🤖 *Suki Subbots* — disfruta tu bot 💖
━━━━━━━━━━━━━━━━━━`.trim();
}

// ------------------------------------------------------------
// Gating: a quién responde el subbot
// ------------------------------------------------------------
function isAllowedMessage(number, m, senderVariants, isGroup, chatId) {
  if (m.key.fromMe) return true;

  const dir = subDataDir(number);
  const variants = Array.isArray(senderVariants) ? senderVariants : [senderVariants].filter(Boolean);

  if (isGroup) {
    // En grupos solo responde si el grupo fue agregado con addgrupo
    const grupos = readJsonCached(path.join(dir, "grupos.json"), []);
    return Array.isArray(grupos) && grupos.includes(chatId);
  }

  // Privado: él mismo o números agregados con addlista (PN, PN+0 o LID)
  if (variants.includes(DIGITS(number))) return true;
  const lista = readJsonCached(path.join(dir, "lista.json"), []);
  if (!Array.isArray(lista)) return false;
  const listaNums = new Set(lista.map(DIGITS).filter(Boolean));
  return variants.some((n) => listaNums.has(n));
}

// ------------------------------------------------------------
// Helpers de enforcement (admins, antidelete, advertencias)
// ------------------------------------------------------------
const addZero = (n) => {
  const c = DIGITS(n);
  if (!c) return "";
  return c.endsWith("0") ? c : c + "0";
};

// 🔥 Precalienta dispositivos y sesiones de cifrado de TODOS los miembros
// de un grupo en segundo plano. En grupos grandes, el envío paga pedir los
// dispositivos y sesiones de cada miembro (por eso ~360ms en grupos llenos
// y ~15ms en chicos). Con esto, cuando el bot responde ya está todo listo.
async function prewarmGroupSessions(sock, chatId) {
  try {
    sock.__prewarmTs = sock.__prewarmTs || new Map();
    const last = sock.__prewarmTs.get(chatId) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return; // 1 vez cada 10 min por grupo
    sock.__prewarmTs.set(chatId, Date.now());
    if (sock.__prewarmTs.size > 300) {
      const first = sock.__prewarmTs.keys().next().value;
      sock.__prewarmTs.delete(first);
    }

    const meta = await getGroupMetaCached(sock, chatId);
    const jids = (meta?.participants || [])
      .map((p) => (typeof p?.jid === "string" && p.jid) || (typeof p?.id === "string" && p.id) || null)
      .filter(Boolean);
    if (!jids.length) return;

    // 1) Llenar el caché de listas de dispositivos (solo consulta los que faltan)
    if (typeof sock.getUSyncDevices === "function") {
      const devices = await sock.getUSyncDevices(jids, true, false);
      const deviceJids = (devices || []).map((d) => d?.jid).filter(Boolean);

      // 2) Asegurar sesiones de cifrado (assertSessions sin force solo
      //    pide a la red las sesiones que NO existen todavía)
      if (deviceJids.length && typeof sock.assertSessions === "function") {
        await sock.assertSessions(deviceJids, false);
      }
    }
  } catch {
    // silencioso: es solo precalentamiento
  }
}

async function getGroupMetaCached(sock, chatId) {
  sock.__metaCache = sock.__metaCache || new Map();
  const hit = sock.__metaCache.get(chatId);
  if (hit && Date.now() - hit.ts < 60000) return hit.meta;
  const meta = await sock.groupMetadata(chatId).catch(() => null);
  if (meta) {
    sock.__metaCache.set(chatId, { meta, ts: Date.now() });
    if (sock.__metaCache.size > 200) {
      const first = sock.__metaCache.keys().next().value;
      sock.__metaCache.delete(first);
    }
  }
  return meta;
}

async function isGroupAdminSub(sock, chatId, senderNums) {
  try {
    const variants = (Array.isArray(senderNums) ? senderNums : [senderNums])
      .map(DIGITS)
      .filter(Boolean);
    if (!variants.length) return false;
    const meta = await getGroupMetaCached(sock, chatId);
    const parts = Array.isArray(meta?.participants) ? meta.participants : [];
    const adminNums = new Set();
    for (const p of parts) {
      const flag = p?.admin === "admin" || p?.admin === "superadmin";
      if (!flag) continue;
      for (const idv of [p.id, p.jid, p.pn, p.phoneNumber]) {
        const s = String(idv || "");
        if (s.endsWith("@s.whatsapp.net")) adminNums.add(DIGITS(s.split(":")[0]));
        if (s.endsWith("@lid")) {
          adminNums.add(DIGITS(s.split(":")[0]));
          try {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(s);
            if (typeof pn === "string" && pn.endsWith("@s.whatsapp.net")) {
              adminNums.add(DIGITS(pn.split(":")[0]));
            }
          } catch {}
        }
      }
    }
    return variants.some((v) => adminNums.has(v) || (addZero(v) && adminNums.has(addZero(v))));
  } catch {
    return false;
  }
}

function antideleteFile(number) {
  return path.join(subDataDir(number), "antidelete.json");
}

const AD_MEDIA_TYPES = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
const AD_MAX_ENTRIES = 150;

// Guarda el mensaje para el antidelete del subbot (texto y multimedia ≤10MB)
async function saveAntideleteSub(sock, number, m, chatId, isGroup) {
  // 🚫 No guardar mensajes del propio subbot (no se reenvían los suyos)
  if (m.key.fromMe) return;

  const type = Object.keys(m.message || {})[0];
  if (["protocolMessage", "reactionMessage", "viewOnceMessageV2"].includes(type)) return;

  const content = m.message[type];

  // Guardar la identidad REAL del autor (PN si se pudo resolver) + variantes
  // (PN, PN+0, LID) para que la detección del borrado siempre haga match.
  const senderId =
    (m.realJid && String(m.realJid).endsWith("@s.whatsapp.net") && m.realJid) ||
    m.key.participant ||
    m.key.remoteJid;
  const variants = Array.isArray(m.senderVariants) && m.senderVariants.length
    ? m.senderVariants
    : [DIGITS(String(senderId).split("@")[0].split(":")[0])].filter(Boolean);

  const guardado = {
    chatId,
    sender: senderId,
    senderNum: DIGITS(String(senderId).split("@")[0].split(":")[0]),
    senderLid: m.realLid ? DIGITS(String(m.realLid).split("@")[0].split(":")[0]) : "",
    variants,
    type,
    timestamp: Date.now()
  };

  if (AD_MEDIA_TYPES.includes(type)) {
    if (content?.fileLength && Number(content.fileLength) > 10 * 1024 * 1024) return;
    const stream = await sock.wa.downloadContentFromMessage(content, type.replace("Message", ""));
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    guardado.media = buffer.toString("base64");
    guardado.mimetype = content?.mimetype;
  } else if (type === "conversation" || type === "extendedTextMessage") {
    guardado.text = m.message.conversation || m.message.extendedTextMessage?.text || "";
    if (!guardado.text) return;
  } else {
    return;
  }

  const file = antideleteFile(number);
  const db = readJson(file, { g: {}, p: {} });
  const scope = isGroup ? "g" : "p";
  db[scope] = db[scope] || {};
  db[scope][m.key.id] = guardado;

  // Poda: mantener solo los mensajes más recientes
  const entries = Object.entries(db[scope]);
  if (entries.length > AD_MAX_ENTRIES) {
    entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
    for (const [k] of entries.slice(0, entries.length - AD_MAX_ENTRIES)) delete db[scope][k];
  }

  writeJson(file, db);
}

// Reenvía el mensaje eliminado (igual que el antidelete del bot principal,
// resolviendo LID → número real para el match y la mención)
async function handleDeletedSub(sock, number, m, chatId, isGroup) {
  try {
    // 🚫 Ignorar borrados del propio subbot (sus mensajes no se reenvían)
    if (m.key.fromMe) return;

    const enabled = isGroup
      ? Number(sock.getSubConfig(chatId, "antidelete")) === 1
      : Number(sock.getSubConfig("global", "antideletepri")) === 1;
    if (!enabled) return;

    const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
    const isLid = (j) => typeof j === "string" && j.endsWith("@lid");
    const JIDNUM = (j) => DIGITS(String(j || "").split("@")[0].split(":")[0]);

    const deletedId = m.message.protocolMessage.key.id;

    // Identidad del AUTOR del mensaje borrado, como el bot principal:
    // whoDeleted = protocolMessage.key.participant || m.key.participant
    const protoPart = m.message.protocolMessage.key.participant || null;
    const deleterVariants = new Set();
    let deleterPnJid = null;

    const addIdent = (jid) => {
      const d = JIDNUM(jid);
      if (d) {
        deleterVariants.add(d);
        if (addZero(d)) deleterVariants.add(addZero(d));
      }
      if (isUser(jid) && !deleterPnJid) deleterPnJid = `${JIDNUM(jid)}@s.whatsapp.net`;
    };

    if (protoPart) {
      addIdent(protoPart);
      // Resolver la otra identidad (LID↔PN): mapa local, repo y metadata
      if (isLid(protoPart)) {
        const cached = sock.__lidMap?.get?.(protoPart);
        if (isUser(cached)) addIdent(cached);
        if (!deleterPnJid) {
          try {
            const r = await sock.signalRepository?.lidMapping?.getPNForLID?.(protoPart);
            if (isUser(r)) addIdent(r);
          } catch {}
        }
      }
    } else {
      // Sin participant (privado): el autor es el emisor del evento
      for (const v of Array.isArray(m.senderVariants) ? m.senderVariants : []) {
        if (v) {
          deleterVariants.add(v);
          if (addZero(v)) deleterVariants.add(addZero(v));
        }
      }
      if (isUser(m.realJid)) deleterPnJid = `${JIDNUM(m.realJid)}@s.whatsapp.net`;
    }

    // Completar identidad con la metadata del grupo (id @lid / jid PN)
    if (isGroup && deleterVariants.size) {
      try {
        const meta = await getGroupMetaCached(sock, chatId);
        for (const p of meta?.participants || []) {
          const ids = [p?.id, p?.jid, p?.pn, p?.phoneNumber].filter((x) => typeof x === "string");
          if (!ids.some((x) => deleterVariants.has(JIDNUM(x)))) continue;
          for (const x of ids) addIdent(x);
          break;
        }
      } catch {}
    }

    if (!deleterVariants.size) return;

    const db = readJson(antideleteFile(number), { g: {}, p: {} });
    const data = (isGroup ? db.g : db.p) || {};
    const deletedData = data[deletedId];
    if (!deletedData) return;

    // Identidades del AUTOR del mensaje guardado
    const storedVariants = new Set(
      [
        ...(Array.isArray(deletedData.variants) ? deletedData.variants : []),
        deletedData.senderNum,
        deletedData.senderLid,
        JIDNUM(deletedData.sender)
      ].map(DIGITS).filter(Boolean)
    );

    // Solo reenviar si quien borró es el mismo autor (match por cualquier variante).
    // Nota: NO se salta a los admins — en los grupos LID el bot principal
    // tampoco los salta en la práctica, y así es como el usuario lo espera.
    const match = [...storedVariants].some((v) => deleterVariants.has(v));
    if (!match) return;

    // Mención con el número REAL: preferir el PN guardado, luego el resuelto
    let mentionJid = null;
    const storedSender = String(deletedData.sender || "");
    if (isUser(storedSender)) mentionJid = `${JIDNUM(storedSender)}@s.whatsapp.net`;
    else if (deleterPnJid) mentionJid = `${JIDNUM(deleterPnJid)}@s.whatsapp.net`;
    else if (m.realLid) mentionJid = m.realLid;
    else mentionJid = `${deletedData.senderNum || [...storedVariants][0] || "0"}@s.whatsapp.net`;

    const senderNumber = JIDNUM(mentionJid);
    const mentionTag = [mentionJid];

    const type = deletedData.type;
    const mimetype = deletedData.mimetype || "application/octet-stream";
    const buffer = deletedData.media ? Buffer.from(deletedData.media, "base64") : null;

    if (buffer) {
      const sendOpts = {
        [type.replace("Message", "")]: buffer,
        mimetype
      };

      if (type === "stickerMessage") {
        await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `📌 El sticker fue eliminado por @${senderNumber}`,
          mentions: mentionTag
        });
      } else if (type === "audioMessage") {
        await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `🎧 El audio fue eliminado por @${senderNumber}`,
          mentions: mentionTag
        });
      } else {
        sendOpts.caption = `📦 Mensaje eliminado por @${senderNumber}`;
        sendOpts.mentions = mentionTag;
        await sock.sendMessage(chatId, sendOpts, { quoted: m });
      }
    } else if (deletedData.text) {
      await sock.sendMessage(chatId, {
        text: `📝 *Mensaje eliminado:* ${deletedData.text}\n👤 *Usuario:* @${senderNumber}`,
        mentions: mentionTag
      }, { quoted: m });
    }
  } catch (err) {
    console.error(`❌ [subbot ${number}] Error en antidelete:`, err);
  }
}

// Advertencias por enlaces (antilink 3 strikes / linkall 10 strikes)
async function handleLinkViolation(sock, number, m, chatId, senderNum, tipo, limite) {
  const mentionJid =
    (m.realJid && String(m.realJid).endsWith("@s.whatsapp.net") && m.realJid) ||
    m.realLid ||
    `${senderNum}@s.whatsapp.net`;

  // Borrar el mensaje (probando llaves PN/LID)
  const deleteKeys = [m.key];
  for (const participant of [...new Set([m.key.participant, mentionJid].filter(Boolean))]) {
    deleteKeys.push({ remoteJid: chatId, fromMe: false, id: m.key.id, participant });
  }
  for (const dk of deleteKeys) {
    try {
      await sock.sendMessage(chatId, { delete: dk });
      break;
    } catch {}
  }

  const advFile = path.join(subDataDir(number), "advertencias.json");
  const adv = readJson(advFile, {});
  adv[chatId] = adv[chatId] || {};

  const keys = [...new Set(
    [...(Array.isArray(m.senderVariants) ? m.senderVariants : []), senderNum, addZero(senderNum)].filter(Boolean)
  )];
  let current = 0;
  for (const k of keys) current = Math.max(current, Number(adv[chatId][k] || 0));
  const total = current + 1;
  for (const k of keys) adv[chatId][k] = total;
  writeJson(advFile, adv);

  if (total >= limite) {
    await sock.sendMessage(chatId, {
      text: `❌ @${senderNum} fue eliminado por enviar enlaces prohibidos (${limite}/${limite}).`,
      mentions: [mentionJid]
    }).catch(() => {});

    let removed = false;
    for (const jid of [...new Set([m.key.participant, mentionJid].filter(Boolean))]) {
      try {
        await sock.groupParticipantsUpdate(chatId, [jid], "remove");
        removed = true;
        break;
      } catch {}
    }

    if (removed) {
      for (const k of keys) adv[chatId][k] = 0;
      writeJson(advFile, adv);
    }
  } else {
    const razon = tipo === "antilink"
      ? "enviar invitaciones de WhatsApp no está permitido aquí"
      : "no se permiten enlaces externos";
    await sock.sendMessage(chatId, {
      text: `⚠️ @${senderNum}, ${razon}.\nAdvertencia: ${total}/${limite}.`,
      mentions: [mentionJid]
    }).catch(() => {});
  }
}

// === ✅ CONTEO DE MENSAJES EN setwelcome.json PN / LID (por subbot) ===
// Misma lógica que el index.js del bot principal, adaptada para guardar en
// el setwelcome.json de cada subbot. Se llama directo desde el evento
// messages.upsert (antes de cualquier filtro del pipeline), igual que en
// el bot principal, para que totalchat/fantasmas/fankick funcionen bien.
export async function countSubMessage(sock, number, m) {
  try {
    if (!m || !m.message) return;

    const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
    const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

    const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
    const isLid = (j) => typeof j === "string" && j.endsWith("@lid");

    const addZero = (n) => {
      const clean = DIGITS(n);
      if (!clean) return "";
      return clean.endsWith("0") ? clean : clean + "0";
    };

    const cleanUserJid = (jid) => {
      const n = JID_NUM(jid);
      return n ? `${n}@s.whatsapp.net` : null;
    };

    const cleanLidJid = (jid) => {
      const n = JID_NUM(jid);
      return n ? `${n}@lid` : null;
    };

    async function getSenderChatKeys() {
      const botNumber = JID_NUM(sock.user?.id || sock.user?.jid || "");
      const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : "";

      const raw = m.key.fromMe
        ? botJid
        : String(m.key.participant || m.key.remoteJid || "");

      let realJid = null;
      let lidJid = null;

      const pnFields = [
        m.realJid,
        m.key?.senderPn,
        m.key?.participantPn,
        m.key?.senderAlt,
        m.key?.participantAlt,
        raw
      ].filter(Boolean);

      for (const jid of pnFields) {
        if (isUser(jid)) {
          realJid = cleanUserJid(jid);
          break;
        }
      }

      const lidFields = [
        m.realLid,
        m.realJid,
        m.key?.senderLid,
        m.key?.participantLid,
        raw
      ].filter(Boolean);

      for (const jid of lidFields) {
        if (isLid(jid)) {
          lidJid = cleanLidJid(jid);
          break;
        }
      }

      try {
        if (global.lidMap instanceof Map) {
          if (lidJid && !realJid) {
            const pn = global.lidMap.get(lidJid);
            if (isUser(pn)) realJid = cleanUserJid(pn);
          }

          if (realJid && !lidJid) {
            const lid = global.lidMap.get(realJid);
            if (isLid(lid)) lidJid = cleanLidJid(lid);
          }
        }
      } catch {}

      try {
        if (lidJid && !realJid) {
          const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
          if (isUser(pn)) {
            realJid = cleanUserJid(pn);

            if (global.lidMap instanceof Map) {
              global.lidMap.set(lidJid, realJid);
              global.lidMap.set(realJid, lidJid);
            }
          }
        }
      } catch {}

      try {
        if (realJid && !lidJid) {
          const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
          if (isLid(lid)) {
            lidJid = cleanLidJid(lid);

            if (global.lidMap instanceof Map) {
              global.lidMap.set(realJid, lidJid);
              global.lidMap.set(lidJid, realJid);
            }
          }
        }
      } catch {}

      let baseNumber = realJid ? JID_NUM(realJid) : "";
      let lidNumber = lidJid ? JID_NUM(lidJid) : "";

      if (!baseNumber && isUser(raw)) baseNumber = JID_NUM(raw);
      if (!lidNumber && isLid(raw)) lidNumber = JID_NUM(raw);

      if (!baseNumber && m.realNumber && isUser(m.realJid)) {
        baseNumber = DIGITS(m.realNumber);
      }

      if (!lidNumber && m.realNumber && (isLid(m.realJid) || isLid(m.realLid) || isLid(raw))) {
        lidNumber = DIGITS(m.realNumber);
      }

      const zeroNumber = baseNumber ? addZero(baseNumber) : "";

      const keys = [];

      if (baseNumber) keys.push(baseNumber);
      if (zeroNumber && zeroNumber !== baseNumber) keys.push(zeroNumber);
      if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) keys.push(lidNumber);

      const rawNumber = JID_NUM(raw);
      if (!keys.length && rawNumber) keys.push(rawNumber);

      return [...new Set(keys)];
    }

    const welcomePath = path.join(subDataDir(number), "setwelcome.json");

    if (!fs.existsSync(welcomePath)) {
      fs.writeFileSync(welcomePath, JSON.stringify({}, null, 2));
    }

    let welcomeData = {};
    try {
      welcomeData = JSON.parse(fs.readFileSync(welcomePath, "utf-8"));
    } catch {
      welcomeData = {};
    }

    const chatId = m.key.remoteJid;
    const isGroup = typeof chatId === "string" && chatId.endsWith("@g.us");

    if (isGroup) {
      welcomeData[chatId] = welcomeData[chatId] || {};
      welcomeData[chatId].chatCount = welcomeData[chatId].chatCount || {};

      const keys = await getSenderChatKeys();

      if (keys.length) {
        let current = 0;

        for (const key of keys) {
          const val = Number(welcomeData[chatId].chatCount[key] || 0);
          if (val > current) current = val;
        }

        const next = current + 1;

        for (const key of keys) {
          welcomeData[chatId].chatCount[key] = next;
        }

        fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));
      }
    }
  } catch (e) {
    console.error(`❌ [subbot ${number}] Error en conteo de mensajes en setwelcome.json:`, e);
  }
}
// === ✅ FIN CONTEO DE MENSAJES EN setwelcome.json PN / LID ===

// ------------------------------------------------------------
// Manejador de mensajes por subbot (ligero, para aguantar 500+)
// ------------------------------------------------------------
export async function handleSubMessage(sock, number, m) {
  if (!m || !m.message) return;

  // Marca de llegada: los comandos (ej. ping) la usan para medir la
  // velocidad real de procesamiento del bot.
  m.__subRecvAt = Date.now();

  const chatId = m.key.remoteJid;
  if (!chatId || chatId === "status@broadcast") return;
  const isGroup = chatId.endsWith("@g.us");

  // 🔥 Precalentar el caché de metadata del grupo SIN bloquear este mensaje:
  // así los envíos a grupos no tienen que consultar la metadata (más rápidos).
  if (isGroup && sock.__metaCache) {
    const hit = sock.__metaCache.get(chatId);
    if (!hit || Date.now() - hit.ts > 45000) {
      getGroupMetaCached(sock, chatId).catch(() => {});
    }
    // Y precalentar dispositivos + sesiones de cifrado de los miembros
    // (en grupos grandes esto era lo que hacía lentos los envíos)
    prewarmGroupSessions(sock, chatId).catch(() => {});
  }

  // --- Normalización LID → número real (como el index.js del bot principal:
  // conserva las DOS identidades, PN y LID, y las cachea en un mapa) ---
  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid = (j) => typeof j === "string" && j.endsWith("@lid");
  const JIDNUM = (j) => DIGITS(String(j || "").split("@")[0].split(":")[0]);

  sock.__lidMap = sock.__lidMap || new Map();

  const rawSender = m.key.participant || m.key.remoteJid;

  let lidJid =
    (isLid(m.key?.senderLid) && m.key.senderLid) ||
    (isLid(m.key?.participantLid) && m.key.participantLid) ||
    (isLid(rawSender) && rawSender) ||
    null;

  let pnJid =
    (isUser(rawSender) && rawSender) ||
    (isUser(m.key?.senderPn) && m.key.senderPn) ||
    (isUser(m.key?.participantPn) && m.key.participantPn) ||
    (isUser(m.key?.senderAlt) && m.key.senderAlt) ||
    (isUser(m.key?.participantAlt) && m.key.participantAlt) ||
    null;

  // Caché negativo: si una resolución LID↔PN ya falló hace poco, no volver
  // a esperar al signalRepository en cada mensaje (evita latencia repetida).
  sock.__lidMiss = sock.__lidMiss || new Map();
  const LID_MISS_TTL = 5 * 60 * 1000;
  const lidMissRecently = (k) => {
    const t = sock.__lidMiss.get(k);
    return typeof t === "number" && Date.now() - t < LID_MISS_TTL;
  };
  const markLidMiss = (k) => {
    sock.__lidMiss.set(k, Date.now());
    if (sock.__lidMiss.size > 500) {
      const first = sock.__lidMiss.keys().next().value;
      sock.__lidMiss.delete(first);
    }
  };

  // Resolver LID → PN: primero mapa local, luego signalRepository
  if (!pnJid && lidJid) {
    const cached = sock.__lidMap.get(lidJid);
    if (isUser(cached)) {
      pnJid = cached;
    } else if (!lidMissRecently(lidJid)) {
      try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
        if (isUser(pn)) pnJid = pn;
        else markLidMiss(lidJid);
      } catch {
        markLidMiss(lidJid);
      }
    }
  }

  // Completar el LID desde el mapa si solo tenemos PN
  if (pnJid && !lidJid) {
    const cachedLid = sock.__lidMap.get(pnJid);
    if (isLid(cachedLid)) lidJid = cachedLid;
    if (!lidJid && !lidMissRecently(pnJid)) {
      try {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
        if (isLid(lid)) lidJid = lid;
        else markLidMiss(pnJid);
      } catch {
        markLidMiss(pnJid);
      }
    }
  }

  // 🔎 Completar identidad con la METADATA del grupo (como hace el bot
  // principal): los participantes traen id (@lid) y jid (@s.whatsapp.net),
  // así siempre tenemos las dos identidades aunque WhatsApp mande solo una.
  if (isGroup && (!pnJid || !lidJid)) {
    try {
      const meta = await getGroupMetaCached(sock, chatId);
      const targetNum = JIDNUM(pnJid || lidJid || rawSender);
      if (targetNum) {
        for (const p of meta?.participants || []) {
          const ids = [p?.id, p?.jid, p?.pn, p?.phoneNumber].filter((x) => typeof x === "string");
          if (!ids.some((x) => JIDNUM(x) === targetNum)) continue;
          for (const x of ids) {
            if (!pnJid && isUser(x)) pnJid = `${JIDNUM(x)}@s.whatsapp.net`;
            if (!lidJid && isLid(x)) lidJid = `${JIDNUM(x)}@lid`;
          }
          break;
        }
      }
    } catch {}
  }

  // Guardar el mapeo LID ↔ PN para futuros mensajes (con tope de memoria).
  // También lo espejamos en global.lidMap: los comandos de grupo portados
  // del bot principal (isAdminByNumber/isAdminInGroup) resuelven admins con
  // global.lidMap. El bot principal la llena en su normalización; el subbot
  // debe hacer lo mismo para que sepa quién es admin. Son mapeos LID↔PN
  // globales (hechos ciertos), seguros de compartir entre bots.
  if (pnJid && lidJid) {
    sock.__lidMap.set(lidJid, pnJid);
    sock.__lidMap.set(pnJid, lidJid);
    if (sock.__lidMap.size > 1000) {
      const first = sock.__lidMap.keys().next().value;
      sock.__lidMap.delete(first);
    }

    if (!(global.lidMap instanceof Map)) global.lidMap = new Map();
    global.lidMap.set(lidJid, pnJid);
    global.lidMap.set(pnJid, lidJid);
    if (global.lidMap.size > 20000) {
      const gfirst = global.lidMap.keys().next().value;
      global.lidMap.delete(gfirst);
    }
  }

  const senderJid = pnJid || rawSender;
  if (isGroup && pnJid) m.key.participant = pnJid;

  m.realJid = senderJid;
  m.realLid = lidJid;
  m.realNumber = JIDNUM(senderJid);

  const pnNum = pnJid ? JIDNUM(pnJid) : "";
  const lidNum = lidJid ? JIDNUM(lidJid) : "";

  // Todas las identidades numéricas del remitente (PN, PN+0, LID)
  const senderVariants = [...new Set(
    [pnNum, addZero(pnNum), lidNum, m.realNumber].filter(Boolean)
  )];
  m.senderVariants = senderVariants;

  const senderNum = m.realNumber;
  const fromMe = !!m.key.fromMe;
  const swFile = path.join(subDataDir(number), "setwelcome.json");

  // === 🗑️ ANTIDELETE: detectar mensaje eliminado (antes del filtro,
  // así el antidelete privado funciona con cualquier usuario) ===
  if (m.message?.protocolMessage?.type === 0) {
    await handleDeletedSub(sock, number, m, chatId, isGroup);
    return;
  }

  // === 🗑️ ANTIDELETE: guardar mensajes si está activo ===
  try {
    const adOn = isGroup
      ? Number(sock.getSubConfig(chatId, "antidelete")) === 1
      : Number(sock.getSubConfig("global", "antideletepri")) === 1;
    if (adOn) await saveAntideleteSub(sock, number, m, chatId, isGroup);
  } catch (e) {
    console.error(`❌ [subbot ${number}] Error guardando antidelete:`, e.message);
  }

  // === 🔇 USUARIOS MUTEADOS (lista por subbot en setwelcome.json) ===
  if (isGroup && !fromMe) {
    try {
      const sw = readJsonCached(swFile, {});
      const mutedNums = new Set(
        (Array.isArray(sw?.[chatId]?.muted) ? sw[chatId].muted : [])
          .map(DIGITS)
          .filter(Boolean)
      );

      if (senderVariants.some((n) => mutedNums.has(n))) {
        sock.__muteCounter = sock.__muteCounter || {};
        const ck = `${chatId}:${senderNum}`;
        const count = (sock.__muteCounter[ck] = (sock.__muteCounter[ck] || 0) + 1);
        const mentionJid =
          (m.realJid && String(m.realJid).endsWith("@s.whatsapp.net") && m.realJid) ||
          m.realLid ||
          `${senderNum}@s.whatsapp.net`;

        if (count === 8) {
          await sock.sendMessage(chatId, {
            text: `⚠️ @${senderNum}, estás *muteado*. Si sigues enviando mensajes podrías ser eliminado.`,
            mentions: [mentionJid]
          }).catch(() => {});
        }

        if (count === 13) {
          await sock.sendMessage(chatId, {
            text: `⛔ @${senderNum}, estás al *límite*. Un mensaje más y serás eliminado.`,
            mentions: [mentionJid]
          }).catch(() => {});
        }

        if (count >= 15) {
          const isAdmin = await isGroupAdminSub(sock, chatId, senderVariants);
          if (!isAdmin) {
            let removed = false;
            for (const jid of [...new Set([m.key.participant, mentionJid].filter(Boolean))]) {
              try {
                await sock.groupParticipantsUpdate(chatId, [jid], "remove");
                removed = true;
                break;
              } catch {}
            }
            if (removed) {
              await sock.sendMessage(chatId, {
                text: `❌ @${senderNum} fue eliminado por ignorar el mute.`,
                mentions: [mentionJid]
              }).catch(() => {});
              delete sock.__muteCounter[ck];
            }
          }
        }

        // Borrar el mensaje del muteado
        const deleteKeys = [m.key];
        for (const participant of [...new Set([m.key.participant, mentionJid].filter(Boolean))]) {
          deleteKeys.push({ remoteJid: chatId, fromMe: false, id: m.key.id, participant });
        }
        for (const dk of deleteKeys) {
          try {
            await sock.sendMessage(chatId, { delete: dk });
            break;
          } catch {}
        }
        return;
      }
    } catch {}
  }

  // --- Texto del mensaje ---
  const messageContent =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

  // === 🚫 ANTIS: spam de stickers (5 avisos / 3 strikes en 15s) ===
  if (isGroup && !fromMe) {
    try {
      const stickerMsg = m.message?.stickerMessage || m.message?.ephemeralMessage?.message?.stickerMessage;
      if (stickerMsg && Number(sock.getSubConfig(chatId, "antis")) === 1) {
        sock.__antisSpam = sock.__antisSpam || {};
        const now = Date.now();
        const key = `${chatId}:${senderNum}`;
        const ud = sock.__antisSpam[key] || { count: 0, last: now, strikes: 0 };

        if (now - ud.last > 15000) {
          ud.count = 1;
          ud.strikes = 0;
        } else {
          ud.count++;
        }
        ud.last = now;
        sock.__antisSpam[key] = ud;

        const mentionJid =
          (m.realJid && String(m.realJid).endsWith("@s.whatsapp.net") && m.realJid) ||
          m.realLid ||
          `${senderNum}@s.whatsapp.net`;

        if (ud.count === 5) {
          await sock.sendMessage(chatId, {
            text: `⚠️ @${senderNum} has enviado *5 stickers*. Espera *15 segundos* o si envías *3 más*, serás eliminado.`,
            mentions: [mentionJid]
          }).catch(() => {});
        }

        if (ud.count > 5) {
          try {
            await sock.sendMessage(chatId, {
              delete: { remoteJid: chatId, fromMe: false, id: m.key.id, participant: m.key.participant || mentionJid }
            });
          } catch {}

          ud.strikes++;
          if (ud.strikes >= 3) {
            const isAdmin = await isGroupAdminSub(sock, chatId, senderVariants);
            if (!isAdmin) {
              await sock.sendMessage(chatId, {
                text: `❌ @${senderNum} fue eliminado por ignorar advertencias y abusar de stickers.`,
                mentions: [mentionJid]
              }).catch(() => {});
              try {
                await sock.groupParticipantsUpdate(chatId, [m.key.participant || mentionJid], "remove");
              } catch {}
              delete sock.__antisSpam[key];
            }
          }
          return;
        }
      }
    } catch {}
  }

  // === 🔗 ANTILINK / LINKALL (con advertencias por subbot) ===
  if (isGroup && !fromMe && messageContent) {
    try {
      const antilinkOn = Number(sock.getSubConfig(chatId, "antilink")) === 1;
      const linkallOn = Number(sock.getSubConfig(chatId, "linkall")) === 1;

      if (antilinkOn || linkallOn) {
        const esInvitacionWA = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(messageContent);
        const esLink = /https?:\/\/[^\s]+/i.test(messageContent);

        let tipo = null;
        let limite = 0;
        if (antilinkOn && esInvitacionWA) {
          tipo = "antilink";
          limite = 3;
        } else if (linkallOn && esLink && !esInvitacionWA) {
          tipo = "linkall";
          limite = 10;
        }

        if (tipo) {
          const isAdmin = await isGroupAdminSub(sock, chatId, senderVariants);
          if (!isAdmin) {
            await handleLinkViolation(sock, number, m, chatId, senderNum, tipo, limite);
            return;
          }
        }
      }
    } catch {}
  }

  // --- Filtro de a quién responde (después de la moderación, igual que el
  // filtro privado del bot principal que va después de mute/antilink) ---
  if (!isAllowedMessage(number, m, senderVariants, isGroup, chatId)) return;

  // === 🤖 CHATGPT POR GRUPO (toggle "chat on/off" por subbot) ===
  if (isGroup && !fromMe && messageContent) {
    try {
      if (Number(sock.getSubConfig(chatId, "chatgpt")) === 1) {
        const axios = (await import("axios")).default;
        const encodedText = encodeURIComponent(messageContent);
        const sessionID = "1727468410446638";
        const apiUrl = `https://api.neoxr.eu/api/gpt4-session?q=${encodedText}&session=${sessionID}&apikey=russellxz`;
        const res = await axios.get(apiUrl);
        const respuesta = res.data?.data?.message;
        if (respuesta) {
          await sock.sendMessage(chatId, { text: respuesta }, { quoted: m }).catch(() => {});
        }
      }
    } catch (e) {
      console.error(`❌ [subbot ${number}] Error en ChatGPT por grupo:`, e.message);
    }
  }

  // === 💬 RESPUESTA POR PALABRA CLAVE (guar — almacén LOCAL de cada subbot,
  // toggle "reacion" por grupo en activoss.json del subbot) ===
  if (messageContent) {
    try {
      const activossData = readJsonCached(path.join(subDataDir(number), "activoss.json"), {});
      const estadoReacion = String(activossData?.[chatId]?.reacion || "on").toLowerCase();

      if (estadoReacion !== "off") {
        let guarData = {};

        // Datos propios del subbot (no comparte multimedia con otros ni con el principal)
        const guarPath = path.join(subDataDir(number), "guar.json");
        if (fs.existsSync(guarPath)) {
          try {
            guarData = JSON.parse(fs.readFileSync(guarPath, "utf-8"));
          } catch {
            guarData = {};
          }
        }

        const guarFilesPath = path.join(subDataDir(number), "guar_files.json");
        if (fs.existsSync(guarFilesPath)) {
          try {
            const filesDb = JSON.parse(fs.readFileSync(guarFilesPath, "utf-8"));
            for (const k of Object.keys(filesDb)) {
              if (!Array.isArray(guarData[k])) guarData[k] = [];
              guarData[k] = guarData[k].concat(filesDb[k]);
            }
          } catch {}
        }

        if (Object.keys(guarData).length > 0) {
          const cleanText = String(messageContent || "")
            .toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .replace(/[^\w]/g, "");

          for (const key of Object.keys(guarData)) {
            const cleanKey = String(key || "")
              .toLowerCase()
              .normalize("NFD").replace(/[̀-ͯ]/g, "")
              .replace(/[^\w]/g, "");

            if (cleanText === cleanKey && guarData[key]?.length) {
              const item = guarData[key][Math.floor(Math.random() * guarData[key].length)];

              let buffer = null;
              if (item.path) {
                try {
                  const filePath = path.resolve(item.path);
                  if (fs.existsSync(filePath)) buffer = fs.readFileSync(filePath);
                } catch {}
              }
              if (!buffer && item.media) {
                try {
                  buffer = Buffer.from(item.media, "base64");
                } catch {}
              }
              if (!buffer || !buffer.length) break;

              const extension = String(item.ext || item.mime?.split("/")?.[1] || "bin").toLowerCase();
              const mime = item.mime || "";
              const payload = {};

              if (["jpg", "jpeg", "png"].includes(extension)) {
                payload.image = buffer;
              } else if (["mp4", "mkv", "webm"].includes(extension)) {
                payload.video = buffer;
              } else if (["mp3", "ogg", "opus"].includes(extension)) {
                payload.audio = buffer;
                payload.mimetype = mime || "audio/mpeg";
                payload.ptt = false;
              } else if (["webp"].includes(extension)) {
                payload.sticker = buffer;
              } else {
                payload.document = buffer;
                payload.mimetype = mime || "application/octet-stream";
                payload.fileName = item.fileName || `archivo.${extension}`;
              }

              await sock.sendMessage(chatId, payload, { quoted: m }).catch(() => {});
              return;
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ [subbot ${number}] Error en palabra clave:`, e.message);
    }
  }

  // === 👮 MODOADMINS: solo responde a admins y al mismo subbot ===
  // (va al final, como en el index.js principal, para que la moderación
  // de arriba siga funcionando aunque esté activo)
  if (isGroup && !fromMe) {
    try {
      if (Number(sock.getSubConfig(chatId, "modoadmins")) === 1) {
        const isAdmin = await isGroupAdminSub(sock, chatId, senderVariants);
        if (!isAdmin) return;
      }
    } catch {}
  }

  if (!messageContent) return;

  // --- Prefijos propios del subbot ---
  const prefixes = Array.isArray(sock.subPrefixes) && sock.subPrefixes.length
    ? sock.subPrefixes
    : DEFAULT_SUB_PREFIXES;

  const prefixUsed = prefixes.find((p) => p && messageContent.startsWith(p));
  if (!prefixUsed) return;

  const command = messageContent.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();
  if (!command) return;
  const rawArgs = messageContent.trim().slice(prefixUsed.length + command.length).trim();
  const args = rawArgs.length ? rawArgs.split(/\s+/) : [];

  // === ⛔ USUARIOS BANEADOS: no pueden usar comandos ===
  if (!fromMe) {
    try {
      const sw = readJsonCached(swFile, {});
      const bannedNums = new Set(
        (Array.isArray(sw?.[chatId]?.banned) ? sw[chatId].banned : [])
          .map(DIGITS)
          .filter(Boolean)
      );

      if (senderVariants.some((n) => bannedNums.has(n))) {
        const frases = [
          "🚫 @usuario estás baneado. ¡Abusaste demasiado del subbot!",
          "❌ Lo siento @usuario, pero tú ya no puedes usarme.",
          "🔒 No tienes permiso @usuario. Fuiste baneado.",
          "👎 ¡Bloqueado! @usuario no puedes usar el subbot.",
          "😤 Quisiste usarme pero estás baneado, @usuario."
        ];
        const texto = frases[Math.floor(Math.random() * frases.length)].replace("@usuario", `@${senderNum}`);
        await sock.sendMessage(chatId, {
          text: texto,
          mentions: [`${senderNum}@s.whatsapp.net`]
        }, { quoted: m }).catch(() => {});
        return;
      }

      // === 🚷 COMANDOS RESTRINGIDOS (restchat) ===
      const restringidos = Array.isArray(sw?.[chatId]?.restringidos) ? sw[chatId].restringidos : [];
      if (restringidos.includes(command)) {
        await sock.sendMessage(chatId, {
          text: "🚫 *Este comando está restringido en este grupo.*\nSolo el *dueño del subbot* puede usarlo."
        }, { quoted: m }).catch(() => {});
        return;
      }
    } catch {}
  }

  // Despacho O(1) por índice (con fallback al recorrido clásico)
  let plugin = global.subPluginIndex?.get?.(command);
  if (!plugin) {
    plugin = (global.subPlugins || []).find((p) => p?.command?.includes?.(command));
  }
  if (!plugin) return;

  try {
    if (typeof plugin === "function") {
      await plugin(m, {
        conn: sock,
        text: rawArgs,
        args,
        command,
        usedPrefix: prefixUsed,
        isSubbot: true,
        subbotNumber: number
      });
    } else if (typeof plugin.run === "function") {
      await plugin.run({ msg: m, conn: sock, args, command, isSubbot: true, subbotNumber: number });
    }
  } catch (e) {
    console.error(chalk.red(`❌ [subbot ${number}] Error ejecutando ${command}:`), e);
  }
}

// ------------------------------------------------------------
// Limpieza de sesión (para que el usuario pueda volver a conectarse)
// ------------------------------------------------------------
export function wipeSession(number) {
  const dir = subSessionDir(number);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    console.log(chalk.yellow(`🧹 [subbot ${number}] Carpeta de sesión eliminada.`));
  } catch (e) {
    console.error(chalk.red(`[subbot ${number}] Error borrando sesión:`), e.message);
  }
  // Reiniciar tiempo/estado para una futura reconexión limpia
  try {
    const cfg = getSubConfig(number);
    cfg.connectedSince = null;
    cfg.welcomed = false;
    saveSubConfig(number, cfg);
  } catch {}
}

export function stopSubbot(number, { wipe = false } = {}) {
  const num = DIGITS(number);
  const entry = subbots.get(num);
  if (entry) {
    entry.stopped = true;
    clearTimeout(entry.pairingTimer);
    clearTimeout(entry.reconnectTimer);
    clearInterval(entry.presenceTimer);
    try {
      entry.sock?.ev?.removeAllListeners?.();
      entry.sock?.end?.();
    } catch {}
    subbots.delete(num);
  }
  if (wipe) wipeSession(num);
}

// ------------------------------------------------------------
// 🧼 Limpieza periódica del antidelete (como SistemaLimpieza del
// bot principal, que vacía antidelete.db cada 15 minutos)
// ------------------------------------------------------------
let antideleteCleanerStarted = false;

function startAntideleteCleaner() {
  if (antideleteCleanerStarted) return;
  antideleteCleanerStarted = true;

  setInterval(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) return;
      const dirs = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
      let cleaned = 0;
      for (const d of dirs) {
        const f = path.join(DATA_DIR, d.name, "antidelete.json");
        if (fs.existsSync(f)) {
          writeJson(f, { g: {}, p: {} });
          cleaned++;
        }
      }
      if (cleaned) console.log(chalk.cyanBright(`🧼 [subbots] antidelete.json limpiado en ${cleaned} subbot(s).`));
    } catch (e) {
      console.error(chalk.red("❌ [subbots] Error limpiando antidelete:"), e.message);
    }
  }, 15 * 60 * 1000); // cada 15 minutos, igual que el bot principal
}

// ------------------------------------------------------------
// ⏰ ABRIR/CERRAR GRUPOS PROGRAMADO — ejecuta las acciones de los
// comandos "abrir Xm" y "cerrar Xm" de cada subbot. Es UN SOLO
// intervalo global que usa siempre el socket VIVO de cada subbot
// (así las reconexiones no dejan tareas huérfanas).
// ------------------------------------------------------------
const TIMER_OPEN_VIDEO = "https://cdn.russellxz.click/b5635057.mp4";
const TIMER_CLOSE_VIDEO = "https://cdn.russellxz.click/1f9e8232.mp4";

function emptyTimeGroup(obj, key) {
  return obj[key] && Object.keys(obj[key]).length === 0;
}

// Procesa los tiempos programados de UN subbot (exportado para pruebas)
export async function processGroupTimes(sock, num, now = Date.now()) {
  const dir = subDataDir(num);
  const openFile = path.join(dir, "tiempo_grupo.json");
  const closeFile = path.join(dir, "tiempogrupo2.json");

  const hasOpen = fs.existsSync(openFile);
  const hasClose = fs.existsSync(closeFile);
  if (!hasOpen && !hasClose) return;

  const abrirData = hasOpen ? readJson(openFile, {}) : {};
  const cerrarData = hasClose ? readJson(closeFile, {}) : {};

  const groups = new Set([
    ...Object.keys(abrirData || {}),
    ...Object.keys(cerrarData || {})
  ]);

  let changedOpen = false;
  let changedClose = false;

  for (const chatId of groups) {
    try {
      const openTime = abrirData?.[chatId]?.abrir ?? null;
      const closeTime = cerrarData?.[chatId]?.cerrar ?? null;

      const dueOpen = typeof openTime === "number" && now >= openTime;
      const dueClose = typeof closeTime === "number" && now >= closeTime;
      if (!dueOpen && !dueClose) continue;

      // Si ambos vencieron, ejecuta el MÁS RECIENTE (mayor timestamp)
      let action;
      if (dueOpen && dueClose) {
        action = closeTime >= openTime ? "close" : "open";
      } else if (dueClose) {
        action = "close";
      } else {
        action = "open";
      }

      try {
        if (action === "close") {
          await sock.groupSettingUpdate(chatId, "announcement");
          await sock.sendMessage(chatId, {
            video: { url: TIMER_CLOSE_VIDEO },
            caption: "🔒 El grupo ha sido cerrado automáticamente."
          }).catch(() => {});
        } else {
          await sock.groupSettingUpdate(chatId, "not_announcement");
          await sock.sendMessage(chatId, {
            video: { url: TIMER_OPEN_VIDEO },
            caption: "🔓 El grupo ha sido abierto automáticamente."
          }).catch(() => {});
        }
        console.log(chalk.cyan(`⏰ [subbot ${num}] Grupo ${chatId} ${action === "close" ? "cerrado" : "abierto"} automáticamente.`));
      } catch (e) {
        // Si falla (por permisos, etc.), igual limpiamos el tiempo para no ciclar
        await sock.sendMessage(chatId, {
          text: `⚠️ No pude ${action === "close" ? "cerrar" : "abrir"} el grupo (quizá no soy admin). Se limpia la tarea programada.`
        }).catch(() => {});
      }

      // Limpiar tiempos ejecutados
      if (action === "open" && abrirData?.[chatId]?.abrir) {
        delete abrirData[chatId].abrir;
        if (emptyTimeGroup(abrirData, chatId)) delete abrirData[chatId];
        changedOpen = true;
      }
      if (action === "close" && cerrarData?.[chatId]?.cerrar) {
        delete cerrarData[chatId].cerrar;
        if (emptyTimeGroup(cerrarData, chatId)) delete cerrarData[chatId];
        changedClose = true;
      }
    } catch (err) {
      console.error(chalk.red(`❌ [subbot ${num}] Error procesando tiempo de grupo ${chatId}:`), err?.message || err);
    }
  }

  if (changedOpen) writeJson(openFile, abrirData);
  if (changedClose) writeJson(closeFile, cerrarData);
}

let groupTimerStarted = false;
let groupTimerRunning = false;

function startGroupTimeChecker() {
  if (groupTimerStarted) return;
  groupTimerStarted = true;

  setInterval(async () => {
    if (groupTimerRunning) return; // evita solapes
    groupTimerRunning = true;
    try {
      const now = Date.now();
      for (const [num, entry] of subbots.entries()) {
        if (entry.stopped || entry.status !== "open" || !entry.sock) continue;
        await processGroupTimes(entry.sock, num, now).catch(() => {});
      }
    } catch (e) {
      console.error(chalk.red("❌ [subbots] Error en el chequeo de tiempos de grupos:"), e?.message || e);
    } finally {
      groupTimerRunning = false;
    }
  }, 10000); // cada 10s, igual que el bot principal
}

// ------------------------------------------------------------
// Conexión de un subbot (con auto-reconexión)
// ------------------------------------------------------------
export async function startSubbot(number, opts = {}) {
  const num = DIGITS(number);
  if (!num) throw new Error("Número inválido");

  const existing = subbots.get(num);
  if (existing && !existing.stopped) {
    if (existing.status === "open") return { already: true };
    // hay un intento en curso; si piden emparejar de nuevo, reiniciamos
    if (opts.requestPairing) stopSubbot(num, { wipe: true });
    else return { pending: true };
  }

  const entry = {
    sock: null,
    status: "connecting",
    attempts: 0,
    stopped: false,
    opts,
    pairingTimer: null,
    reconnectTimer: null,
    presenceTimer: null,
    notifiedConnect: false
  };
  subbots.set(num, entry);

  await loadSubPlugins();
  startAntideleteCleaner();
  startGroupTimeChecker();
  await connectSubbot(num, entry);

  // Si es una vinculación nueva, dar 5 minutos para completar el código
  if (opts.requestPairing) {
    entry.pairingTimer = setTimeout(async () => {
      const e = subbots.get(num);
      if (e && e.status !== "open") {
        console.log(chalk.yellow(`⌛ [subbot ${num}] Tiempo de vinculación agotado.`));
        stopSubbot(num, { wipe: true });
        try {
          await opts.onFail?.("⌛ Tiempo agotado. No se completó la vinculación en 5 minutos. Usa *code* de nuevo para intentarlo.");
        } catch {}
      }
    }, 5 * 60 * 1000);
  }

  return { started: true };
}

// ------------------------------------------------------------
// Vinculación desde la PÁGINA WEB: el usuario escribe su número en la web,
// el panel manda una task y aquí se genera el código de 8 dígitos que se
// muestra directamente en la página (sin pasar por WhatsApp).
// ------------------------------------------------------------
export async function requestSubbotPairingWeb(number) {
  let digits = DIGITS(number);
  if (!digits) throw new Error("Escribe tu número de WhatsApp con el código de país.");

  // 🇲🇽 México: WhatsApp necesita 521 + 10 dígitos (igual que el comando code)
  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) {
    digits = "521" + digits.slice(2);
  }

  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Número inválido. Escríbelo con código de país, ej: 507 6500-7845");
  }

  const existing = subbots.get(digits);
  if (existing && existing.status === "open") {
    throw new Error(`El número +${digits} ya está conectado como subbot.`);
  }

  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(val);
    };
    // Si en 45s no salió el código, avisar (el usuario puede reintentar)
    const timer = setTimeout(() => {
      finish(reject, new Error("No se pudo generar el código a tiempo. Intenta de nuevo."));
    }, 45000);

    startSubbot(digits, {
      requestPairing: true,
      onPairingCode: (code) => {
        const fmt = String(code).match(/.{1,4}/g)?.join("-") || String(code);
        finish(resolve, { number: digits, code: String(code), codeFormatted: fmt });
      },
      onFail: (msgText) => {
        finish(reject, new Error(msgText || "No se pudo generar el código de vinculación."));
      }
    }).catch((e) => finish(reject, e));
  });
}

async function connectSubbot(num, entry) {
  const B = await getBaileys();
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    downloadContentFromMessage
  } = B;

  const version = await getWaVersion(B);
  const sessionDir = subSessionDir(num);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const wasRegistered = !!state.creds?.registered;

  // Sesión sin registrar y sin vinculación en curso → sesión rota: limpiar
  if (!wasRegistered && !entry.opts?.requestPairing) {
    console.log(chalk.yellow(`🧹 [subbot ${num}] Sesión sin registrar. Limpiando...`));
    stopSubbot(num, { wipe: true });
    return null;
  }

  // Caché de metadata de grupos compartido con los chequeos de admin.
  // Pasarlo a makeWASocket evita que Baileys consulte la metadata del grupo
  // en CADA envío (esa consulta era gran parte de la latencia en grupos).
  const metaCache = new Map();

  const sock = makeWASocket({
    version,
    logger: silentLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger)
    },
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    cachedGroupMetadata: async (jid) => {
      const hit = metaCache.get(jid);
      return hit && Date.now() - hit.ts < 60000 ? hit.meta : undefined;
    },
    userDevicesCache: getDeviceListCache()
  });

  entry.sock = sock;
  entry.status = "connecting";
  sock.__metaCache = metaCache;

  // Cualquier consulta de metadata (nuestra o de un plugin) alimenta el caché
  const origGroupMetadata = sock.groupMetadata.bind(sock);
  sock.groupMetadata = async (jid, ...rest) => {
    const meta = await origGroupMetadata(jid, ...rest);
    if (meta && typeof jid === "string" && jid.endsWith("@g.us")) {
      metaCache.set(jid, { meta, ts: Date.now() });
      if (metaCache.size > 200) {
        const first = metaCache.keys().next().value;
        metaCache.delete(first);
      }
    }
    return meta;
  };

  // Helpers inyectados para los plugins del subbot
  const cfg = getSubConfig(num);
  sock.isSubbot = true;
  sock.subbotNumber = num;
  sock.subPrefixes = cfg.prefixes;
  sock.subDataDir = subDataDir(num);
  sock.readSubData = (file, fallback) => readJson(path.join(subDataDir(num), file), fallback);
  sock.writeSubData = (file, data) => writeJson(path.join(subDataDir(num), file), data);

  // ⚙️ Configuración por chat (equivalente a activos.db del bot principal,
  // pero en activos.json INDEPENDIENTE por subbot)
  const activosFile = path.join(subDataDir(num), "activos.json");
  sock.getSubConfig = (cid, key) => {
    const a = readJsonCached(activosFile, {});
    return a?.[cid]?.[key];
  };
  sock.setSubConfig = (cid, key, value) => {
    const a = readJson(activosFile, {});
    if (!a[cid]) a[cid] = {};
    a[cid][key] = value;
    writeJson(activosFile, a);
  };
  sock.getAllSubConfigs = (cid) => {
    const a = readJsonCached(activosFile, {});
    return { ...(a?.[cid] || {}) };
  };
  sock.deleteSubConfig = (cid, key) => {
    const a = readJson(activosFile, {});
    if (a[cid]) {
      delete a[cid][key];
      if (!Object.keys(a[cid]).length) delete a[cid];
      writeJson(activosFile, a);
    }
  };
  sock.wa = { downloadContentFromMessage };
  global.wa = global.wa || { downloadContentFromMessage };

  // Compat con plugins que usan sendMessage2 (menús del bot principal)
  sock.sendMessage2 = async (chat, content, quotedMsg, options = {}) => {
    if (content?.sticker) {
      return sock.sendMessage(chat, { sticker: content.sticker }, { quoted: quotedMsg, ...options });
    }
    return sock.sendMessage(chat, content, { quoted: quotedMsg, ...options });
  };

  sock.lidParser = function (participants = []) {
    try {
      return participants.map((v) => ({
        ...v,
        id:
          typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid
            ? v.jid
            : v.id
      }));
    } catch {
      return participants || [];
    }
  };

  sock.ev.on("creds.update", saveCreds);

  // 🏷️ Guardar el nombre del subbot en cuanto WhatsApp lo entregue.
  // En una vinculación nueva sock.user.name llega vacío en "open" y se
  // rellena unos segundos después; sin esto salía "Sin nombre" hasta reiniciar.
  const refreshSubName = () => {
    try {
      const nm = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || "";
      if (!nm) return false;
      const cfg = getSubConfig(num);
      if (cfg.name !== nm) {
        cfg.name = nm;
        saveSubConfig(num, cfg);
      }
      return true;
    } catch {
      return false;
    }
  };
  sock.__refreshSubName = refreshSubName;
  sock.ev.on("creds.update", refreshSubName);
  sock.ev.on("contacts.update", refreshSubName);

  // Plugins con eventos (bienvenidas/despedidas del subbot)
  for (const plugin of global.subPlugins || []) {
    if (typeof plugin.run === "function" && !plugin.command) {
      try {
        plugin.run(sock, { wa: sock.wa });
      } catch (e) {
        console.error(chalk.red(`❌ [subbot ${num}] Error en plugin de eventos:`), e);
      }
    }
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages?.[0];

    // Conteo de mensajes (totalchat/fantasmas/fankick): directo en el
    // evento, ANTES de cualquier filtro del pipeline, igual que en el
    // index.js del bot principal.
    try {
      await countSubMessage(sock, num, m);
    } catch (e) {
      console.error(chalk.red(`❌ [subbot ${num}] Error en conteo:`), e);
    }

    try {
      await handleSubMessage(sock, num, m);
    } catch (e) {
      console.error(chalk.red(`❌ [subbot ${num}] Error en mensaje:`), e);
    }
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (entry.stopped) return;

    if (connection === "open") {
      entry.status = "open";
      entry.attempts = 0;
      clearTimeout(entry.pairingTimer);
      console.log(chalk.green(`✅ [subbot ${num}] Conectado.`));

      // 🕶️ NO aparecer "en línea": mandar presencia "unavailable" al conectar.
      // El fork ignora la presencia si creds.me.name está vacío (pasa en
      // subbots recién vinculados), así que se le pone un nombre de respaldo.
      // Se re-afirma cada 5 minutos por si algo la resetea; así el usuario
      // solo sale en línea cuando ÉL abre su WhatsApp.
      const goOffline = async () => {
        try {
          const me = sock.authState?.creds?.me;
          if (me && !me.name) me.name = sock.user?.name || "Suki Subbot";
          await sock.sendPresenceUpdate("unavailable");
        } catch {}
      };
      setTimeout(goOffline, 2000);
      clearInterval(entry.presenceTimer);
      entry.presenceTimer = setInterval(goOffline, 5 * 60 * 1000);

      // Persistir tiempo de conexión (no se reinicia con el servidor)
      // y el nombre del usuario (para el comando "bots")
      const cfg2 = getSubConfig(num);
      let cfgChanged = false;
      if (!cfg2.connectedSince) {
        cfg2.connectedSince = Date.now();
        cfgChanged = true;
      }
      const userName = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || "";
      if (userName && cfg2.name !== userName) {
        cfg2.name = userName;
        cfgChanged = true;
      }
      // Dispositivo/plataforma del teléfono vinculado (para el comando "bots")
      const platform = sock.authState?.creds?.platform || "";
      if (platform && cfg2.platform !== platform) {
        cfg2.platform = platform;
        cfgChanged = true;
      }
      if (cfgChanged) saveSubConfig(num, cfg2);

      // Reintentos por si el nombre aún no llega (vinculación nueva)
      if (!userName && typeof sock.__refreshSubName === "function") {
        [3000, 8000, 20000].forEach((ms) => setTimeout(() => sock.__refreshSubName(), ms));
      }

      // Primera conexión: instrucciones a su propio número
      if (!cfg2.welcomed) {
        setTimeout(async () => {
          try {
            await sock.sendMessage(`${num}@s.whatsapp.net`, { text: buildInstructions(num) });
            const cfg3 = getSubConfig(num);
            cfg3.welcomed = true;
            saveSubConfig(num, cfg3);
          } catch (e) {
            console.error(chalk.red(`[subbot ${num}] No se pudo enviar instrucciones:`), e.message);
          }
        }, 3000);
      }

      // Avisar al chat donde se usó "code"
      if (!entry.notifiedConnect) {
        entry.notifiedConnect = true;
        try {
          await entry.opts?.onConnected?.();
        } catch {}
      }
      return;
    }

    if (connection === "close") {
      entry.status = "close";
      clearInterval(entry.presenceTimer);
      const codeErr =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.output?.payload?.statusCode ||
        0;

      // 401 loggedOut / 403 / 411 multi-device mismatch → borrar sesión
      if ([401, 403, 411].includes(Number(codeErr))) {
        console.log(chalk.red(`🔌 [subbot ${num}] Sesión cerrada (${codeErr}). Eliminando carpeta de sesión...`));
        stopSubbot(num, { wipe: true });
        return;
      }

      // Si nunca se registró y no está en fase de emparejamiento activo, limitar reintentos
      const stillPairing = !wasRegistered && !entry.sock?.authState?.creds?.registered;
      if (stillPairing && entry.opts?.requestPairing && entry.attempts >= 6) {
        console.log(chalk.yellow(`⚠️ [subbot ${num}] Demasiados intentos sin vincular.`));
        stopSubbot(num, { wipe: true });
        try {
          await entry.opts?.onFail?.("❌ No se pudo completar la vinculación. Intenta de nuevo con *code*.");
        } catch {}
        return;
      }

      // Auto-reconexión con backoff (incluye el reinicio 515 tras vincular)
      entry.attempts += 1;
      const delay = Math.min(5000 * entry.attempts, 60000);
      console.log(chalk.yellow(`🔁 [subbot ${num}] Reconectando en ${Math.round(delay / 1000)}s (intento ${entry.attempts})...`));
      entry.reconnectTimer = setTimeout(() => {
        if (!entry.stopped) {
          connectSubbot(num, entry).catch((e) => {
            console.error(chalk.red(`❌ [subbot ${num}] Error reconectando:`), e.message);
            entry.reconnectTimer = setTimeout(() => {
              if (!entry.stopped) connectSubbot(num, entry).catch(() => {});
            }, 30000);
          });
        }
      }, delay);
    }
  });

  // Solicitar código de vinculación de 8 dígitos si es una sesión nueva
  if (!state.creds?.registered && entry.opts?.requestPairing && !entry.pairingSent) {
    setTimeout(async () => {
      if (entry.stopped || entry.pairingSent) return;
      for (let i = 0; i < 3; i++) {
        try {
          const code = await sock.requestPairingCode(num);
          entry.pairingSent = true;
          console.log(chalk.magenta(`🔑 [subbot ${num}] Código: ${code}`));
          try {
            await entry.opts?.onPairingCode?.(code);
          } catch {}
          return;
        } catch (e) {
          console.log(chalk.yellow(`[subbot ${num}] Reintentando código de vinculación (${i + 1}/3): ${e.message}`));
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      try {
        await entry.opts?.onFail?.("❌ No se pudo generar el código de vinculación. Intenta de nuevo.");
      } catch {}
      stopSubbot(num, { wipe: true });
    }, 3000);
  }

  return sock;
}

// ------------------------------------------------------------
// Información de subbots (para el comando "bots")
// ------------------------------------------------------------
export function listSubbots() {
  ensureDirs();
  const out = [];
  for (const [num, entry] of subbots.entries()) {
    // Aprovechar para refrescar el nombre si el socket ya lo tiene
    try { entry.sock?.__refreshSubName?.(); } catch {}
    const cfg = getSubConfig(num);
    const liveName = entry.sock?.user?.name || entry.sock?.user?.verifiedName || entry.sock?.user?.notify || "";

    // Prefijos actuales (en vivo si el socket está activo, si no del config)
    const livePrefixes = Array.isArray(entry.sock?.subPrefixes) && entry.sock.subPrefixes.length
      ? entry.sock.subPrefixes
      : null;

    out.push({
      number: num,
      name: liveName || cfg.name || "Suki Subbot",
      prefixes: livePrefixes || cfg.prefixes || [...DEFAULT_SUB_PREFIXES],
      platform: entry.sock?.authState?.creds?.platform || cfg.platform || "",
      status: entry.status,
      connected: entry.status === "open",
      connectedSince: cfg.connectedSince
    });
  }
  return out;
}

// Traduce el valor de creds.platform a un nombre legible del dispositivo
export function formatPlatform(p) {
  const v = String(p || "").toLowerCase();
  if (!v) return "Desconocido";
  if (v === "android") return "Android 🤖";
  if (v === "iphone" || v === "ios") return "iPhone 🍎";
  if (v === "smba") return "WhatsApp Business (Android) 💼";
  if (v === "smbi") return "WhatsApp Business (iPhone) 💼";
  if (v.includes("web")) return "WhatsApp Web 🌐";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function formatUptime(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ------------------------------------------------------------
// Arranque de todos los subbots ya vinculados (al iniciar el server)
// ------------------------------------------------------------
export async function initSubbots() {
  ensureDirs();
  await loadSubPlugins();

  let sessions = [];
  try {
    sessions = fs
      .readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => {
        const credsFile = path.join(SESSIONS_DIR, name, "creds.json");
        if (!fs.existsSync(credsFile)) return false;
        // Solo reconectar sesiones que completaron la vinculación
        const creds = readJson(credsFile, {});
        if (!creds.registered) {
          wipeSession(name); // sesión a medias: borrar para que puedan volver a vincular
          return false;
        }
        return true;
      });
  } catch {}

  if (!sessions.length) {
    console.log(chalk.cyan("🤖 [subbots] No hay subbots vinculados todavía."));
    return;
  }

  console.log(chalk.cyan(`🤖 [subbots] Reconectando ${sessions.length} subbot(s)...`));

  // Arranque escalonado para no saturar (estable hasta 500+ subbots)
  for (const num of sessions) {
    startSubbot(num).catch((e) =>
      console.error(chalk.red(`❌ [subbot ${num}] Error al iniciar:`), e.message)
    );
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ------------------------------------------------------------
// Lógica compartida del comando "code" (bot principal y subbots)
// ------------------------------------------------------------
export async function handleCodeCommand(msg, { conn, args, botName = "La Suki Bot" }) {
  const chatId = msg.key.remoteJid;
  const pref =
    (conn?.subPrefixes && conn.subPrefixes[0]) ||
    (Array.isArray(global.prefixes) && global.prefixes[0]) ||
    ".";

  // 🔒 Si el hosting de subbots está desactivado, solo el dueño del bot
  // (o el propio bot) puede conectar subbots. Los demás quedan bloqueados.
  if (!conn.isSubbot && !getSubbotHosting()) {
    const fromMe = !!msg.key.fromMe;
    const senderNum = DIGITS(msg.realJid || msg.key.participant || msg.key.remoteJid || "");
    const isOwner = fromMe ||
      (typeof global.isOwner === "function" && senderNum && global.isOwner(senderNum));
    if (!isOwner) {
      return conn.sendMessage(
        chatId,
        { text: "🚫 Este bot no está aceptando nuevos subbots por ahora.\nEl dueño puede activarlo desde el panel web." },
        { quoted: msg }
      );
    }
  }

  const raw = (args || []).join(" ").trim();
  let digits = DIGITS(raw);

  if (!digits) {
    return conn.sendMessage(
      chatId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

✳️ *Conéctate como subbot:*

📌 Escribe el comando con tu número y su código de país:
   *${pref}code +507 6500-7845*


📲 El bot te enviará un *código de 8 dígitos* para
vincular desde WhatsApp → *Dispositivos vinculados*.
`.trim()
      },
      { quoted: msg }
    );
  }

  // 🇲🇽 México: WhatsApp necesita 521 + 10 dígitos. Se agrega el 1 automático
  // solo si el usuario NO lo puso ya (52 + 10 dígitos = 12; con 1 son 13).
  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) {
    digits = "521" + digits.slice(2);
  }

  if (digits.length < 8 || digits.length > 15) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Número inválido. Ejemplo: *${pref}code +507 6500-7845*` },
      { quoted: msg }
    );
  }

  const existing = subbots.get(digits);
  if (existing && existing.status === "open") {
    return conn.sendMessage(
      chatId,
      { text: `⚠️ El número *+${digits}* ya está conectado como subbot.\nUsa *${pref}bots* para ver los subbots activos.` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }).catch(() => {});

  try {
    await startSubbot(digits, {
      requestPairing: true,
      onPairingCode: async (code) => {
        const fmt = String(code).match(/.{1,4}/g)?.join("-") || code;
        const texto = `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

🔑 *TU CÓDIGO DE VINCULACIÓN (+${digits})*

╭━━━━━━━━━━━━━╮
   👉  *${fmt}*
╰━━━━━━━━━━━━━╯

📲 *CÓMO VINCULAR:*
1️⃣ Abre *WhatsApp* en tu teléfono.
2️⃣ Ve a *Ajustes* → *Dispositivos vinculados*.
3️⃣ Toca *Vincular un dispositivo*.
4️⃣ Elige *Vincular con el número de teléfono*.
5️⃣ Escribe el *código de 8 dígitos* de arriba
   (usa el botón 📋 para copiarlo).

⏳ Tienes *5 minutos* para completar la vinculación.
🎥 Mira el video si tienes dudas.`.trim();

        // 🎬 UN SOLO MENSAJE: video + explicación + código + botón de copiar
        try {
          await conn.sendMessage(
            chatId,
            {
              video: { url: CODE_VIDEO },
              caption: texto,
              footer: "❦ Suki Subbots ❦",
              nativeFlow: [
                {
                  text: "📋 Copiar código",
                  copy: String(code)
                }
              ]
            },
            { quoted: msg }
          );
        } catch (e) {
          console.log("[subbots] Mensaje interactivo falló, usando fallback:", e.message);
          await conn.sendMessage(
            chatId,
            { video: { url: CODE_VIDEO }, caption: texto },
            { quoted: msg }
          ).catch(async () => {
            await conn.sendMessage(chatId, { text: texto }, { quoted: msg }).catch(() => {});
          });
        }
      },
      onConnected: async () => {
        try {
          await conn.sendMessage(
            chatId,
            {
              text: `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

🎉 *¡Bienvenido al sistema de Subbots!*
✅ El número *+${digits}* se conectó exitosamente.

📩 Ve a tu propio número aquí:
👉 https://wa.me/${digits}

Ahí te dejé un mensaje con las *instrucciones* de cómo
usar *addgrupo*, *addlista*, *setprefix* y todo tu subbot 🤖

🤖 ${botName}`.trim(),
              mentions: [`${digits}@s.whatsapp.net`]
            },
            { quoted: msg }
          );
          await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
        } catch (e) {
          console.log("[subbots] No se pudo avisar la conexión:", e.message);
        }
      },
      onFail: async (reason) => {
        try {
          await conn.sendMessage(chatId, { text: reason }, { quoted: msg });
        } catch {}
      }
    });
  } catch (e) {
    await conn.sendMessage(
      chatId,
      { text: `❌ Error iniciando el subbot: ${e.message}` },
      { quoted: msg }
    ).catch(() => {});
  }
}

export { MENU_IMAGE };
