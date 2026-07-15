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
const MENU_IMAGE = "https://cdn.russellxz.click/707c3d7c.jpg";
const CODE_VIDEO = "https://cdn.russellxz.click/664808e9.mp4";

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
      console.log(chalk.cyan(`🧩 [subbots] ${list.length} plugins de subbots cargados.`));
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
function isAllowedMessage(number, m, senderNum, isGroup, chatId) {
  if (m.key.fromMe) return true;

  const dir = subDataDir(number);

  if (isGroup) {
    // En grupos solo responde si el grupo fue agregado con addgrupo
    const grupos = readJsonCached(path.join(dir, "grupos.json"), []);
    return Array.isArray(grupos) && grupos.includes(chatId);
  }

  // Privado: él mismo o números agregados con addlista
  if (senderNum && senderNum === DIGITS(number)) return true;
  const lista = readJsonCached(path.join(dir, "lista.json"), []);
  return Array.isArray(lista) && lista.map(DIGITS).includes(senderNum);
}

// ------------------------------------------------------------
// Manejador de mensajes por subbot (ligero, para aguantar 500+)
// ------------------------------------------------------------
async function handleSubMessage(sock, number, m) {
  if (!m || !m.message) return;

  const chatId = m.key.remoteJid;
  if (!chatId || chatId === "status@broadcast") return;
  const isGroup = chatId.endsWith("@g.us");

  // --- Normalización ligera LID → número real ---
  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid = (j) => typeof j === "string" && j.endsWith("@lid");

  let senderJid = m.key.participant || m.key.remoteJid;
  const pnAlt =
    (isUser(m.key?.senderPn) && m.key.senderPn) ||
    (isUser(m.key?.participantPn) && m.key.participantPn) ||
    (isUser(m.key?.senderAlt) && m.key.senderAlt) ||
    (isUser(m.key?.participantAlt) && m.key.participantAlt) ||
    null;

  if (pnAlt) {
    senderJid = pnAlt;
    if (isGroup) m.key.participant = pnAlt;
  } else if (isLid(senderJid)) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(senderJid);
      if (isUser(pn)) {
        senderJid = pn;
        if (isGroup) m.key.participant = pn;
      }
    } catch {}
  }

  m.realJid = senderJid;
  m.realNumber = DIGITS(String(senderJid).split("@")[0].split(":")[0]);

  const senderNum = m.realNumber;

  // --- Filtro de a quién responde ---
  if (!isAllowedMessage(number, m, senderNum, isGroup, chatId)) return;

  // --- Texto del mensaje ---
  const messageContent =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

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

  const plugins = global.subPlugins || [];

  for (const plugin of plugins) {
    const isClassic = typeof plugin === "function";
    const isCompatible = plugin.command?.includes?.(command);
    try {
      if (isClassic && isCompatible) {
        await plugin(m, {
          conn: sock,
          text: rawArgs,
          args,
          command,
          usedPrefix: prefixUsed,
          isSubbot: true,
          subbotNumber: number
        });
        break;
      }
      if (!isClassic && isCompatible && typeof plugin.run === "function") {
        await plugin.run({ msg: m, conn: sock, args, command, isSubbot: true, subbotNumber: number });
        break;
      }
    } catch (e) {
      console.error(chalk.red(`❌ [subbot ${number}] Error ejecutando ${command}:`), e);
    }
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
    try {
      entry.sock?.ev?.removeAllListeners?.();
      entry.sock?.end?.();
    } catch {}
    subbots.delete(num);
  }
  if (wipe) wipeSession(num);
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
    notifiedConnect: false
  };
  subbots.set(num, entry);

  await loadSubPlugins();
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
    generateHighQualityLinkPreview: false
  });

  entry.sock = sock;
  entry.status = "connecting";

  // Helpers inyectados para los plugins del subbot
  const cfg = getSubConfig(num);
  sock.isSubbot = true;
  sock.subbotNumber = num;
  sock.subPrefixes = cfg.prefixes;
  sock.subDataDir = subDataDir(num);
  sock.readSubData = (file, fallback) => readJson(path.join(subDataDir(num), file), fallback);
  sock.writeSubData = (file, data) => writeJson(path.join(subDataDir(num), file), data);
  sock.wa = { downloadContentFromMessage };
  global.wa = global.wa || { downloadContentFromMessage };

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

      // Persistir tiempo de conexión (no se reinicia con el servidor)
      const cfg2 = getSubConfig(num);
      if (!cfg2.connectedSince) {
        cfg2.connectedSince = Date.now();
        saveSubConfig(num, cfg2);
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
    const cfg = getSubConfig(num);
    out.push({
      number: num,
      status: entry.status,
      connected: entry.status === "open",
      connectedSince: cfg.connectedSince
    });
  }
  return out;
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

🇲🇽 *Números de México:* solo pon *${pref}code +52* y el resto
del número; el bot agrega el *1* automáticamente
(quedaría +521...).

📲 El bot te enviará un *código de 8 dígitos* para
vincular desde WhatsApp → *Dispositivos vinculados*.
`.trim()
      },
      { quoted: msg }
    );
  }

  // 🇲🇽 México: WhatsApp necesita 521 + 10 dígitos. Se agrega el 1 automático.
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

  // 🎬 Video con la explicación de cómo vincular
  try {
    await conn.sendMessage(
      chatId,
      {
        video: { url: CODE_VIDEO },
        caption: `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

📲 *CÓMO VINCULAR TU SUBBOT (+${digits})*

1️⃣ Abre *WhatsApp* en tu teléfono.
2️⃣ Ve a *Ajustes* → *Dispositivos vinculados*.
3️⃣ Toca *Vincular un dispositivo*.
4️⃣ Elige *Vincular con el número de teléfono*.
5️⃣ Escribe el *código de 8 dígitos* que te mandaré
   en el siguiente mensaje (botón para copiarlo 📋).

⏳ Tienes *5 minutos* para completar la vinculación.
🎥 Mira el video de arriba si tienes dudas.
`.trim()
      },
      { quoted: msg }
    );
  } catch (e) {
    console.log("[subbots] No se pudo enviar el video de code:", e.message);
  }

  try {
    await startSubbot(digits, {
      requestPairing: true,
      onPairingCode: async (code) => {
        const fmt = String(code).match(/.{1,4}/g)?.join("-") || code;
        const texto = `
🔑 *TU CÓDIGO DE VINCULACIÓN*

╭━━━━━━━━━━━━━╮
   👉  *${fmt}*
╰━━━━━━━━━━━━━╯

📲 WhatsApp → *Dispositivos vinculados* →
*Vincular con el número de teléfono* y escribe el código.

⏳ Válido por pocos minutos. Toca el botón para copiarlo.`.trim();

        try {
          await conn.sendMessage(
            chatId,
            {
              text: texto,
              footer: "❦ Suki Subbots ❦",
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copiar código",
                    copy_code: String(code)
                  })
                }
              ],
              headerType: 1
            },
            { quoted: msg }
          );
        } catch (e) {
          console.log("[subbots] Botón copiar falló, enviando texto plano:", e.message);
          await conn.sendMessage(chatId, { text: texto }, { quoted: msg }).catch(() => {});
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
