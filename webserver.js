"use strict";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

import {
  getConfig,
  setConfig,
  deleteConfig,
  getAllConfigs
} from "./db.js";

import {
  listSubbots,
  formatPlatform,
  formatUptime,
  getSubbotHosting,
  setSubbotHosting
} from "./subbots.js";

/*
  webserver.js para La Suki Bot
  - Relay/polling con el panel central.
  - Compatible con Pterodactyl.
  - Detecta puerto/IP/URL pública automáticamente.
  - Notifica en grupos cuando se cambia configuración, se abre/cierra grupo o se saca a Suki.
*/

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

const DEFAULT_PANEL_URL = "https://lasukibot.ultraplus.click";
const DEFAULT_PORT = 30261;

const SUKI_PANEL_URL = normalizeUrl(
  process.env.SUKI_PANEL_URL ||
  process.env.PANEL_URL ||
  DEFAULT_PANEL_URL
);

const SUKI_PUBLIC_WEB_URL = normalizeUrl(
  process.env.SUKI_PUBLIC_WEB_URL ||
  "https://lasukibot.ultraplus.click"
);

const SKY_ULTRA_PLUS_URL = normalizeUrl(
  process.env.SKY_ULTRA_PLUS_URL ||
  "https://dash.skyultraplus.com"
);

function notificationFooter() {
  return `
╭━━━〔 🌐 LA SUKI BOT 〕━━━╮
┃ 💜 Página oficial:
┃ ${SUKI_PUBLIC_WEB_URL}
┃
┃ 🚀 *Sky Ultra Plus*
┃ ⚡ El hosting del futuro
┃ 🤖 Donde la mejor bot está alojada
┃ ${SKY_ULTRA_PLUS_URL}
╰━━━━━━━━━━━━━━━━━━━━━━╯`;
}

const API_KEYS_PATH = path.resolve("./api_keys.json");
const WEB_SETTINGS_PATH = path.resolve("./web_settings.json");
const ACTIVOSS_PATH = path.resolve("./activoss.json");
const RELAY_STATE_PATH = path.resolve("./relay_client_state.json");

const RELAY_POLL_INTERVAL_MS = Number(process.env.SUKI_RELAY_POLL_MS || 15000);
const RELAY_REGISTER_INTERVAL_MS = Number(process.env.SUKI_RELAY_REGISTER_MS || 60000);

const GROUPS_CACHE_MS = Number(process.env.SUKI_GROUPS_CACHE_MS || 2 * 60 * 1000);
const GROUPS_FORCE_COOLDOWN_MS = Number(process.env.SUKI_GROUPS_FORCE_COOLDOWN_MS || 25 * 1000);
const GROUPS_FETCH_TIMEOUT_MS = Number(process.env.SUKI_GROUPS_FETCH_TIMEOUT_MS || 20000);
const MIN_GROUPS_FOR_COOLDOWN = Number(process.env.SUKI_MIN_GROUPS_FOR_COOLDOWN || 8);

const TASK_RESULT_RETRY_ATTEMPTS = Number(process.env.SUKI_TASK_RESULT_RETRIES || 5);
const TASK_RESULT_RETRY_DELAY_MS = Number(process.env.SUKI_TASK_RESULT_RETRY_DELAY_MS || 2500);
const FINISHED_TASK_TTL_MS = Number(process.env.SUKI_FINISHED_TASK_TTL_MS || 10 * 60 * 1000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024
  }
});

const CONFIG_KEYS = new Set([
  "welcome",
  "despedidas",
  "antilink",
  "linkall",
  "antidelete",
  "modoadmins",
  "antiarabe",
  "antis",
  "reaccion"
]);

const CONFIG_LABELS = {
  welcome: "🎉 Bienvenidas",
  despedidas: "👋 Despedidas",
  antilink: "🔗 Antilink",
  linkall: "🌐 LinkAll",
  antidelete: "🛡️ Antidelete",
  modoadmins: "👑 Modo admins",
  antiarabe: "🚫 Anti árabe",
  antis: "🎭 Anti stickers",
  reaccion: "⚡ Reacciones automáticas"
};

const CONFIG_ALIASES = {
  welcome: "welcome",
  bienvenida: "welcome",
  bienvenidas: "welcome",
  welcomes: "welcome",

  despedidas: "despedidas",
  despedida: "despedidas",
  bye: "despedidas",
  byes: "despedidas",
  goodbye: "despedidas",

  antilink: "antilink",
  anti_link: "antilink",
  anti_links: "antilink",
  links: "antilink",

  linkall: "linkall",
  link_all: "linkall",
  all_links: "linkall",

  antidelete: "antidelete",
  anti_delete: "antidelete",
  antieliminar: "antidelete",

  modoadmins: "modoadmins",
  modo_admins: "modoadmins",
  onlyadmins: "modoadmins",
  only_admins: "modoadmins",
  admins: "modoadmins",

  antiarabe: "antiarabe",
  anti_arabe: "antiarabe",
  antiarab: "antiarabe",
  anti_arab: "antiarabe",

  antis: "antis",
  antisticker: "antis",
  antistickers: "antis",
  anti_sticker: "antis",
  anti_stickers: "antis",

  reaccion: "reaccion",
  reacion: "reaccion",
  reaction: "reaccion",
  reactions: "reaccion",
  reacciones: "reaccion"
};

const TASK_TYPE_ALIASES = {
  get_status: "get_status",
  status: "get_status",
  ping: "get_status",

  get_groups: "get_groups",
  groups: "get_groups",
  list_groups: "get_groups",

  set_config: "set_config",
  config: "set_config",
  group_config: "set_config",
  set_group_config: "set_config",
  update_config: "set_config",
  update_group_config: "set_config",
  toggle_config: "set_config",
  activar_config: "set_config",
  deactivate_config: "set_config",

  group_mode: "group_mode",
  set_group_mode: "group_mode",
  update_group_mode: "group_mode",
  change_group_mode: "group_mode",
  open_group: "group_mode",
  close_group: "group_mode",

  send_text: "send_text",
  send_message: "send_text",
  send_msg: "send_text",
  message: "send_text",
  text: "send_text",
  broadcast_text: "send_text",

  send_media: "send_media",
  send_multimedia: "send_media",
  send_file: "send_media",
  send_document: "send_media",
  media: "send_media",
  multimedia: "send_media",
  broadcast_media: "send_media",

  leave_group: "leave_group",
  salir_grupo: "leave_group",
  leave: "leave_group",

  set_subbot_hosting: "set_subbot_hosting",
  subbot_hosting: "set_subbot_hosting",
  toggle_subbot_hosting: "set_subbot_hosting",
  allow_subbots: "set_subbot_hosting"
};

let relayBusy = false;
let relayStarted = false;
let lastGroupsCache = [];
let lastGroupsAt = 0;
let lastPollErrorLogAt = 0;
let lastGroupsFetchAttemptAt = 0;
let lastRegisterOkAt = 0;

const runningTaskIds = new Set();
const finishedTaskIds = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidHash(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
}

function cleanHash(value) {
  const text = String(value || "").trim().toLowerCase();
  if (isValidHash(text)) return text;

  const match = text.match(/[a-f0-9]{64}/i);
  return match ? match[0].toLowerCase() : "";
}

function shortHash(value) {
  const hash = String(value || "").trim();
  return hash ? hash.slice(0, 12) + "..." : "vacío";
}

function unique(values = []) {
  const out = [];

  for (const value of values) {
    const clean = cleanHash(value);
    if (clean && !out.includes(clean)) out.push(clean);
  }

  return out;
}

function normalizeKeyName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

function normalizeConfigKey(value) {
  const raw = normalizeKeyName(value);
  return CONFIG_ALIASES[raw] || raw;
}

function normalizeTaskType(value) {
  const raw = normalizeKeyName(value);
  return TASK_TYPE_ALIASES[raw] || raw;
}

function normalizeGroupMode(value, fallbackType = "") {
  const raw = normalizeKeyName(value || fallbackType);

  if ([
    "open",
    "abrir",
    "abierto",
    "not_announcement",
    "notannouncement",
    "unlocked",
    "public",
    "todos",
    "all"
  ].includes(raw)) {
    return "open";
  }

  if ([
    "close",
    "cerrar",
    "cerrado",
    "announcement",
    "locked",
    "private",
    "admins",
    "admin"
  ].includes(raw)) {
    return "close";
  }

  return raw;
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value === "undefined" || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    return value;
  }

  return undefined;
}

function parseMaybeJSON(value, fallback) {
  try {
    if (typeof value === "undefined" || value === null) return fallback;
    if (typeof value !== "string") return value;

    const clean = value.trim();
    if (!clean) return fallback;

    return JSON.parse(clean);
  } catch {
    return fallback;
  }
}

function objectOrEmpty(value) {
  const parsed = parseMaybeJSON(value, value);

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    !Buffer.isBuffer(parsed)
  ) {
    return parsed;
  }

  return {};
}

function normalizeTaskObject(task = {}) {
  const basePayload = objectOrEmpty(task.payload);

  const payload = {
    ...basePayload,
    ...objectOrEmpty(task.data),
    ...objectOrEmpty(task.body),
    ...objectOrEmpty(task.params)
  };

  const rawType = firstValue(
    task.type,
    task.action,
    task.name,
    task.command,
    payload.type,
    payload.action
  );

  const type = normalizeTaskType(rawType);

  const id = String(firstValue(
    task.id,
    task.taskId,
    task.task_id,
    task._id,
    payload.id,
    payload.taskId,
    payload.task_id
  ) || "");

  return {
    ...task,
    id,
    type,
    rawType,
    payload
  };
}

function normalizeChatId(value) {
  if (typeof value === "object" && value !== null) {
    value = firstValue(
      value.id,
      value.chatId,
      value.chat_id,
      value.groupId,
      value.group_id,
      value.jid,
      value.remoteJid
    );
  }

  const text = String(value || "").trim();
  if (!text) return "";

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseChatIds(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    const out = [];

    for (const item of value) {
      for (const chatId of parseChatIds(item)) {
        if (chatId && !out.includes(chatId)) out.push(chatId);
      }
    }

    return out;
  }

  if (typeof value === "object") {
    const id = normalizeChatId(value);
    return id ? [id] : [];
  }

  if (typeof value === "string") {
    const clean = value.trim();
    if (!clean) return [];

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parseChatIds(parsed);
      if (parsed && typeof parsed === "object") return parseChatIds(parsed);
    } catch {}

    return clean
      .split(",")
      .map(x => normalizeChatId(x))
      .filter(Boolean);
  }

  const id = normalizeChatId(value);
  return id ? [id] : [];
}

function parseChatIdsAny(...values) {
  const out = [];

  for (const value of values) {
    for (const chatId of parseChatIds(value)) {
      const clean = normalizeChatId(chatId);
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }

  return out;
}

function cleanBase64(value) {
  let text = String(value || "").trim();

  if (!text || text === "[limpiado]") return "";

  const dataUrlMatch = text.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    text = dataUrlMatch[2];
  }

  return text.replace(/\s+/g, "");
}

function bufferFromAny(value) {
  if (!value || value === "[limpiado]") return null;

  if (Buffer.isBuffer(value)) return value;

  if (
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data);
  }

  const cleaned = cleanBase64(value);
  if (!cleaned) return null;

  const buffer = Buffer.from(cleaned, "base64");
  return buffer.length ? buffer : null;
}

function guessMimeFromName(fileName = "") {
  const name = String(fileName || "").toLowerCase();

  if (/\.(jpg|jpeg)$/.test(name)) return "image/jpeg";
  if (/\.png$/.test(name)) return "image/png";
  if (/\.webp$/.test(name)) return "image/webp";
  if (/\.gif$/.test(name)) return "image/gif";
  if (/\.mp4$/.test(name)) return "video/mp4";
  if (/\.webm$/.test(name)) return "video/webm";
  if (/\.(mp3|mpeg)$/.test(name)) return "audio/mpeg";
  if (/\.ogg$/.test(name)) return "audio/ogg";
  if (/\.wav$/.test(name)) return "audio/wav";
  if (/\.pdf$/.test(name)) return "application/pdf";

  return "application/octet-stream";
}

function cleanupFinishedTasks() {
  const now = Date.now();

  for (const [taskId, finishedAt] of finishedTaskIds.entries()) {
    if (now - Number(finishedAt || 0) > FINISHED_TASK_TTL_MS) {
      finishedTaskIds.delete(taskId);
    }
  }
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data || {}, null, 2));
  } catch {}
}

function readKeys() {
  const data = readJSON(API_KEYS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function readWebSettings() {
  return readJSON(WEB_SETTINGS_PATH, {});
}

function saveWebSettings(data) {
  saveJSON(WEB_SETTINGS_PATH, data || {});
}

function readActivoss() {
  return readJSON(ACTIVOSS_PATH, {});
}

function saveActivoss(data) {
  saveJSON(ACTIVOSS_PATH, data || {});
}

function readRelayState() {
  return readJSON(RELAY_STATE_PATH, {});
}

function saveRelayState(patch = {}) {
  const old = readRelayState();

  saveJSON(RELAY_STATE_PATH, {
    ...old,
    ...patch,
    updatedAt: Date.now()
  });
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function collectHashesDeep(value, out = [], depth = 0) {
  if (depth > 8) return out;
  if (typeof value === "undefined" || value === null) return out;

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value || "").trim().toLowerCase();

    if (isValidHash(text)) {
      out.push(text);
      return out;
    }

    const matches = text.match(/[a-f0-9]{64}/gi);
    if (matches) {
      for (const m of matches) out.push(m.toLowerCase());
    }

    return out;
  }

  if (Array.isArray(value)) {
    value.forEach(v => collectHashesDeep(v, out, depth + 1));
    return out;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach(k => collectHashesDeep(value[k], out, depth + 1));
  }

  return out;
}

function getHashFromKeyRecord(k = {}) {
  const fromHash = cleanHash(
    k.hash ||
    k.keyHash ||
    k.key_hash ||
    k.primaryKeyHash ||
    k.primary_key_hash ||
    ""
  );

  if (fromHash) return fromHash;

  const raw =
    k.key ||
    k.apiKey ||
    k.apikey ||
    k.rawKey ||
    k.token ||
    "";

  if (raw && typeof raw === "string" && raw.length >= 8) {
    return sha256(raw);
  }

  return "";
}

function getKnownHashesFromLocalFiles() {
  const hashes = [];

  try {
    for (const key of readKeys()) {
      const hash = getHashFromKeyRecord(key);
      if (isValidHash(hash)) hashes.push(hash);
    }
  } catch {}

  try {
    const envHashes = String(process.env.PANEL_KEY_HASHES || process.env.SUKI_PANEL_HASHES || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

    collectHashesDeep(envHashes, hashes);
  } catch {}

  return unique(hashes);
}

function verifyApiKey(rawKey) {
  if (!rawKey) return false;

  const hash = sha256(rawKey);
  const cleanRaw = cleanHash(rawKey);
  const keys = readKeys();

  return keys.some(k => {
    const storedHash = getHashFromKeyRecord(k);
    return (
      k.active !== false &&
      storedHash &&
      (storedHash === hash || storedHash === cleanRaw)
    );
  });
}

function getBearer(req) {
  const auth = String(req.headers.authorization || "");

  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return (
    req.headers["x-api-key"] ||
    req.query.apikey ||
    req.query.apiKey ||
    ""
  );
}

function authMiddleware(req, res, next) {
  const key = getBearer(req);

  if (!verifyApiKey(key)) {
    return res.status(401).json({
      ok: false,
      error: "API key inválida"
    });
  }

  next();
}

function getSock() {
  return global.sukiSock || global.sock || null;
}

function getLiveSock() {
  const currentSock = getSock();

  if (!currentSock) {
    throw new Error("Sock no disponible");
  }

  if (!currentSock.user) {
    throw new Error("WhatsApp no está conectado");
  }

  return currentSock;
}

function getServerPort() {
  return (
    process.env.SERVER_PORT ||
    process.env.P_SERVER_PORT ||
    process.env.SUKI_API_PORT ||
    process.env.PORT ||
    DEFAULT_PORT
  );
}

function getServerIp() {
  return (
    process.env.SERVER_IP ||
    process.env.P_SERVER_IP ||
    process.env.PTERODACTYL_IP ||
    process.env.PTERODACTYL_NODE_IP ||
    process.env.NODE_IP ||
    process.env.ALLOCATION_IP ||
    process.env.HOST ||
    ""
  );
}

function buildDetectedPublicUrl() {
  const fromEnv = normalizeUrl(
    process.env.SUKI_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.WEB_PUBLIC_URL ||
    process.env.APP_URL ||
    process.env.PUBLIC_URL ||
    ""
  );

  if (fromEnv) return fromEnv;

  const settings = readWebSettings();
  const fromSettings = normalizeUrl(settings.public_base_url || "");
  if (fromSettings) return fromSettings;

  const ip = String(getServerIp() || "").trim();
  const port = String(getServerPort() || "").trim();

  if (ip && port && ip !== "0.0.0.0") {
    return normalizeUrl(`http://${ip}:${port}`);
  }

  return "";
}

function setInitialPublicBaseUrl() {
  const current = buildDetectedPublicUrl();
  if (!current) return;

  global.SUKI_PUBLIC_BASE_URL = current;

  const settings = readWebSettings();

  if (settings.public_base_url !== current) {
    settings.public_base_url = current;
    settings.detectedAt = Date.now();
    settings.updatedAt = Date.now();
    saveWebSettings(settings);
  }
}

function getPublicBaseUrl() {
  const settings = readWebSettings();

  return normalizeUrl(
    global.SUKI_PUBLIC_BASE_URL ||
    settings.public_base_url ||
    buildDetectedPublicUrl() ||
    ""
  );
}

function updatePublicBaseUrl(req) {
  try {
    const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
      .split(",")[0]
      .trim();

    const host = String(req.headers["x-forwarded-host"] || req.get("host") || "")
      .split(",")[0]
      .trim();

    if (!host) return;

    const currentUrl = normalizeUrl(`${protocol}://${host}`);

    if (
      !currentUrl ||
      currentUrl.includes("localhost") ||
      currentUrl.includes("127.0.0.1")
    ) {
      return;
    }

    const settings = readWebSettings();

    if (settings.public_base_url !== currentUrl) {
      settings.public_base_url = currentUrl;
      settings.updatedAt = Date.now();

      saveWebSettings(settings);

      global.SUKI_PUBLIC_BASE_URL = currentUrl;
    }
  } catch {}
}

function normalizeConfigValue(value) {
  const v = String(value).toLowerCase();

  return (
    value === true ||
    value === 1 ||
    v === "1" ||
    v === "on" ||
    v === "true" ||
    v === "activar" ||
    v === "activado" ||
    v === "enable" ||
    v === "enabled" ||
    v === "yes" ||
    v === "si" ||
    v === "sí"
  );
}

function getActiveKeyPayload() {
  return readKeys()
    .filter(k => k && k.active !== false)
    .map(k => {
      const hash = getHashFromKeyRecord(k);

      return {
        id: k.id || hash.slice(0, 12),
        hash,
        keyHash: hash,
        key_hash: hash,
        active: k.active !== false,
        createdAt: k.createdAt || null,
        createdBy: k.createdBy || null
      };
    })
    .filter(k => isValidHash(k.hash));
}

function getActiveKeyHashes() {
  const hashes = [];

  for (const k of getActiveKeyPayload()) {
    const hash = cleanHash(k.hash || k.keyHash);
    if (hash && !hashes.includes(hash)) hashes.push(hash);
  }

  return hashes;
}

function getAllPanelHashes() {
  return unique([
    ...getActiveKeyHashes(),
    ...getKnownHashesFromLocalFiles()
  ]);
}

function getPrimaryKeyHash() {
  return getActiveKeyHashes()[0] || getAllPanelHashes()[0] || "";
}

function getReaccionStatus(chatId) {
  const db = readActivoss();
  const estado = String(db?.[chatId]?.reacion || db?.[chatId]?.reaccion || "on").toLowerCase();

  return estado === "off" || estado === "0" || estado === "false" ? 0 : 1;
}

function setReaccionStatus(chatId, active) {
  const db = readActivoss();

  db[chatId] = db[chatId] || {};
  db[chatId].reacion = active ? "on" : "off";
  db[chatId].reaccion = active ? "on" : "off";
  db[chatId].updatedAt = Date.now();

  saveActivoss(db);

  return active ? 1 : 0;
}

function readGroupConfig(chatId) {
  let config = {};

  try {
    config = getAllConfigs(chatId) || {};
  } catch {
    config = {};
  }

  return {
    ...config,
    reaccion: getReaccionStatus(chatId)
  };
}

function hydrateGroupConfig(group = {}) {
  const id = String(group.id || "");
  if (!id) return group;

  return {
    ...group,
    config: {
      ...(group.config || {}),
      ...readGroupConfig(id)
    }
  };
}

function hydrateGroups(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .filter(g => g && g.id)
    .map(g => hydrateGroupConfig(g));
}

function patchCachedGroup(chatId, patch = {}) {
  const id = normalizeChatId(chatId);
  if (!id) return;

  lastGroupsCache = hydrateGroups(lastGroupsCache.map(g => {
    if (String(g.id) !== id) return g;

    return {
      ...g,
      ...patch,
      config: {
        ...(g.config || {}),
        ...(patch.config || {})
      }
    };
  }));

  lastGroupsAt = Date.now();
}

async function sendGroupNotice(sock, chatId, text) {
  try {
    if (!sock) throw new Error("Sock vacío");
    if (!sock.user) throw new Error("Sock sin usuario conectado");
    if (!chatId) throw new Error("chatId vacío");

    return await sock.sendMessage(chatId, { text });
  } catch {
    return null;
  }
}

async function notifyConfig(sock, chatId, key, active) {
  const label = CONFIG_LABELS[key] || key;
  const estado = active ? "activada ✅" : "desactivada ❌";

  const text =
`╭━━━〔 ⚙️ PANEL WEB 〕━━━╮
┃ ✨ *Configuración actualizada*
╰━━━━━━━━━━━━━━━━━━━━━━╯

🧩 *Ajuste:* ${label}
📌 *Estado:* ${estado}

👑 Acción ejecutada por mi dueño desde el panel web de *La Suki Bot*.

${notificationFooter()}`;

  return await sendGroupNotice(sock, chatId, text);
}

async function notifyGroupMode(sock, chatId, mode) {
  let text;

  if (mode === "open") {
    text =
`╭━━━〔 🔓 GRUPO ABIERTO 〕━━━╮
┃ ✨ *Modo del grupo actualizado*
╰━━━━━━━━━━━━━━━━━━━━━━╯

✅ Ahora todos los integrantes pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.

${notificationFooter()}`;
  } else {
    text =
`╭━━━〔 🔒 GRUPO CERRADO 〕━━━╮
┃ ✨ *Modo del grupo actualizado*
╰━━━━━━━━━━━━━━━━━━━━━━╯

👑 Ahora solo los administradores pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.

${notificationFooter()}`;
  }

  return await sendGroupNotice(sock, chatId, text);
}

async function applyGroupMode(sock, chatId, mode) {
  chatId = normalizeChatId(chatId);
  mode = normalizeGroupMode(mode);

  if (!chatId) throw new Error("Falta chatId");

  if (mode === "open") {
    await sock.groupSettingUpdate(chatId, "not_announcement");
    await notifyGroupMode(sock, chatId, "open");

    patchCachedGroup(chatId, {
      announce: false
    });

    return {
      chatId,
      mode: "open",
      announce: false
    };
  }

  if (mode === "close") {
    await notifyGroupMode(sock, chatId, "close");
    await sock.groupSettingUpdate(chatId, "announcement");

    patchCachedGroup(chatId, {
      announce: true
    });

    return {
      chatId,
      mode: "close",
      announce: true
    };
  }

  throw new Error("Modo inválido");
}

async function applyConfig(sock, chatId, key, value, notify = true) {
  chatId = normalizeChatId(chatId);
  key = normalizeConfigKey(key);

  if (!chatId) throw new Error("Falta chatId");
  if (!CONFIG_KEYS.has(key)) throw new Error(`Config no permitida: ${key}`);

  const active = normalizeConfigValue(value);

  if (key === "reaccion") {
    setReaccionStatus(chatId, active);
  } else {
    if (active) {
      setConfig(chatId, key, 1);
    } else {
      deleteConfig(chatId, key);
    }
  }

  patchCachedGroup(chatId, {
    config: {
      [key]: active ? 1 : 0,
      reaccion: key === "reaccion" ? (active ? 1 : 0) : getReaccionStatus(chatId)
    }
  });

  if (notify) {
    await notifyConfig(sock, chatId, key, active);
  }

  lastGroupsAt = 0;

  return {
    chatId,
    key,
    value: active ? 1 : 0
  };
}

function isRateLimitError(e) {
  const msg = String(e?.message || e || "").toLowerCase();

  return (
    msg.includes("rate-overlimit") ||
    msg.includes("rate overlimit") ||
    msg.includes("rate-limit") ||
    msg.includes("too many") ||
    msg.includes("429")
  );
}

function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    })
  ]);
}

function normalizeGroupObject(id, g = {}) {
  return hydrateGroupConfig({
    id,
    subject: g.subject || "Sin nombre",
    owner: g.owner || null,
    announce: !!g.announce,
    restrict: !!g.restrict,
    participants: Array.isArray(g.participants)
      ? g.participants.length
      : Number(g.participants || g.participantsCount || 0)
  });
}

function mergeGroups(oldGroups = [], newGroups = []) {
  const map = new Map();

  for (const g of oldGroups || []) {
    if (g?.id) map.set(String(g.id), g);
  }

  for (const g of newGroups || []) {
    if (g?.id) {
      const old = map.get(String(g.id)) || {};

      map.set(String(g.id), {
        ...old,
        ...g,
        config: {
          ...(old.config || {}),
          ...(g.config || {})
        }
      });
    }
  }

  return hydrateGroups(Array.from(map.values()));
}

function setGroupsCache(groups = [], reason = "update", allowShrink = false) {
  const incoming = hydrateGroups(Array.isArray(groups) ? groups.filter(g => g?.id) : []);

  if (!incoming.length && lastGroupsCache.length) {
    lastGroupsCache = hydrateGroups(lastGroupsCache);
    return lastGroupsCache;
  }

  if (!allowShrink && lastGroupsCache.length && incoming.length < lastGroupsCache.length) {
    const merged = mergeGroups(lastGroupsCache, incoming);

    lastGroupsCache = merged;
    lastGroupsAt = Date.now();

    return lastGroupsCache;
  }

  lastGroupsCache = incoming;
  lastGroupsAt = Date.now();

  return lastGroupsCache;
}

async function getGroups(sock) {
  if (!sock?.user) {
    throw new Error("WhatsApp no está conectado");
  }

  if (typeof sock.groupFetchAllParticipating !== "function") {
    throw new Error("groupFetchAllParticipating no disponible en sock");
  }

  const groups = await withTimeout(
    sock.groupFetchAllParticipating(),
    GROUPS_FETCH_TIMEOUT_MS,
    "Timeout cargando grupos"
  );

  return Object.entries(groups || {}).map(([id, g]) => normalizeGroupObject(id, g));
}

async function getGroupsCached(sock, force = false, allowShrink = false) {
  const now = Date.now();
  const forceFreshShrink = force && allowShrink;

  if (!force && lastGroupsCache.length && now - lastGroupsAt < GROUPS_CACHE_MS) {
    lastGroupsCache = hydrateGroups(lastGroupsCache);
    return lastGroupsCache;
  }

  if (
    !forceFreshShrink &&
    force &&
    lastGroupsCache.length >= MIN_GROUPS_FOR_COOLDOWN &&
    now - lastGroupsAt < GROUPS_FORCE_COOLDOWN_MS
  ) {
    lastGroupsCache = hydrateGroups(lastGroupsCache);
    return lastGroupsCache;
  }

  if (
    !forceFreshShrink &&
    now - lastGroupsFetchAttemptAt < 10000 &&
    lastGroupsCache.length >= MIN_GROUPS_FOR_COOLDOWN
  ) {
    lastGroupsCache = hydrateGroups(lastGroupsCache);
    return lastGroupsCache;
  }

  lastGroupsFetchAttemptAt = now;

  try {
    const freshGroups = await getGroups(sock);
    return setGroupsCache(freshGroups, force ? "force-fetch" : "fetch", allowShrink);
  } catch (e) {
    if (isRateLimitError(e) && lastGroupsCache.length) {
      lastGroupsCache = hydrateGroups(lastGroupsCache);
      return lastGroupsCache;
    }

    if (lastGroupsCache.length) {
      lastGroupsCache = hydrateGroups(lastGroupsCache);
      return lastGroupsCache;
    }

    throw e;
  }
}

async function makeState(sock, forceGroups = false) {
  let groups = [];

  try {
    groups = await getGroupsCached(sock, forceGroups, forceGroups);
  } catch {
    if (lastGroupsCache.length) {
      groups = hydrateGroups(lastGroupsCache);
    }
  }

  return {
    connected: !!sock?.user,
    user: sock?.user || null,
    groups,
    groups_json: JSON.stringify(groups),
    group_cache: groups,
    groups_cache: groups,
    groupsCount: groups.length
  };
}

function buildPanelKeyPayload() {
  const active = getActiveKeyPayload();
  const allHashes = getAllPanelHashes();

  const out = [];

  for (const hash of allHashes) {
    const found = active.find(k => k.hash === hash);

    out.push({
      id: found?.id || hash.slice(0, 12),
      hash,
      keyHash: hash,
      key_hash: hash,
      active: true,
      createdAt: found?.createdAt || null,
      createdBy: found?.createdBy || null
    });
  }

  return out;
}

function buildSubbotInfo() {
  try {
    const sock = getSock();
    const rawId = String(sock?.user?.id || sock?.user?.jid || "");
    const ownerNumber = rawId.split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
    const ownerName = sock?.user?.name || sock?.user?.verifiedName || "La Suki Bot";

    let subbots = [];
    try {
      subbots = (listSubbots() || [])
        .filter(b => b.connected)
        .map(b => ({
          name: b.name || "Suki Subbot",
          device: formatPlatform(b.platform),
          uptime: b.connectedSince ? formatUptime(Date.now() - b.connectedSince) : "—",
          connectedSince: b.connectedSince || null
        }));
    } catch {}

    return {
      subbotHosting: getSubbotHosting(),
      ownerNumber,
      ownerName,
      subbotsCount: subbots.length,
      subbots
    };
  } catch {
    return {
      subbotHosting: getSubbotHosting(),
      ownerNumber: "",
      ownerName: "La Suki Bot",
      subbotsCount: 0,
      subbots: []
    };
  }
}

function buildPanelBody(reason, state = {}, extra = {}) {
  const keys = buildPanelKeyPayload();
  const keyHashes = unique(keys.map(k => k.hash));
  const primaryKeyHash = getPrimaryKeyHash();
  const groups = hydrateGroups(Array.isArray(state.groups) ? state.groups : []);
  const subbotInfo = buildSubbotInfo();

  return {
    botName: "La Suki Bot",
    publicUrl: getPublicBaseUrl(),
    reason,
    registeredAt: Date.now(),

    // 🤖 Info del sistema de subbots (para el directorio público del panel)
    subbotHosting: subbotInfo.subbotHosting,
    ownerNumber: subbotInfo.ownerNumber,
    ownerName: subbotInfo.ownerName,
    subbotsCount: subbotInfo.subbotsCount,
    subbots: subbotInfo.subbots,

    keys,
    hashes: keyHashes,
    keyHashes,
    activeKeys: keyHashes,
    activeKeyHashes: keyHashes,
    allKeyHashes: keyHashes,

    hash: primaryKeyHash,
    keyHash: primaryKeyHash,
    key_hash: primaryKeyHash,
    primaryHash: primaryKeyHash,
    primary_hash: primaryKeyHash,
    primaryKeyHash,
    primary_key_hash: primaryKeyHash,
    botHash: primaryKeyHash,
    bot_hash: primaryKeyHash,
    relayKeyHash: primaryKeyHash,

    user: state.user || null,

    groups,
    groups_json: JSON.stringify(groups),
    group_cache: groups,
    groups_cache: groups,
    groupsCount: groups.length,

    state: {
      ...state,
      connected: !!state.connected,
      user: state.user || null,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups,
      groupsCount: groups.length,
      hash: primaryKeyHash,
      keyHash: primaryKeyHash,
      primaryHash: primaryKeyHash,
      primaryKeyHash,
      hashes: keyHashes,
      keyHashes,
      activeKeyHashes: keyHashes
    },

    ...extra
  };
}

async function registerWithPanel(reason = "manual", stateOverride = null) {
  try {
    const keyHashes = getAllPanelHashes();

    if (!keyHashes.length) return false;

    const sock = getSock();
    const state = stateOverride || (sock ? await makeState(sock, true) : {});
    const body = buildPanelBody(reason, state);

    const res = await axios.post(`${SUKI_PANEL_URL}/api/register-bot`, body, {
      timeout: 25000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) return false;

    lastRegisterOkAt = Date.now();

    saveRelayState({
      primaryKeyHash: getPrimaryKeyHash(),
      keyHashes,
      lastRegisterOkAt,
      lastRegisterReason: reason,
      lastRegisterSentGroups: Array.isArray(body.groups) ? body.groups.length : 0,
      lastRegisterResponse: res.data
    });

    return true;
  } catch {
    return false;
  }
}

async function reportTaskResult(taskId, ok, result = {}, error = "") {
  const keyHashes = getAllPanelHashes();
  const primaryKeyHash = getPrimaryKeyHash();

  const body = {
    taskId,
    task_id: taskId,
    id: taskId,
    ok,
    result: result || {},
    error: error || "",
    botName: "La Suki Bot",
    publicUrl: getPublicBaseUrl(),

    hashes: keyHashes,
    keyHashes,
    activeKeyHashes: keyHashes,
    allKeyHashes: keyHashes,

    hash: primaryKeyHash,
    keyHash: primaryKeyHash,
    key_hash: primaryKeyHash,
    primaryHash: primaryKeyHash,
    primary_hash: primaryKeyHash,
    primaryKeyHash,
    primary_key_hash: primaryKeyHash,
    botHash: primaryKeyHash,
    bot_hash: primaryKeyHash,

    finishedAt: Date.now()
  };

  for (let attempt = 1; attempt <= TASK_RESULT_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(`${SUKI_PANEL_URL}/api/bot/task-result`, body, {
        timeout: 30000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
      });

      if (!res.data || res.data.ok !== true) {
        if (attempt < TASK_RESULT_RETRY_ATTEMPTS) {
          await sleep(TASK_RESULT_RETRY_DELAY_MS);
          continue;
        }

        return false;
      }

      return true;
    } catch {
      if (attempt < TASK_RESULT_RETRY_ATTEMPTS) {
        await sleep(TASK_RESULT_RETRY_DELAY_MS);
      }
    }
  }

  return false;
}

async function executeTask(sock, task) {
  task = normalizeTaskObject(task);

  const type = normalizeTaskType(task.type);
  const payload = task.payload || {};

  if (type === "get_status") {
    return {
      connected: !!sock?.user,
      user: sock?.user || null,
      ...buildSubbotInfo()
    };
  }

  if (type === "set_subbot_hosting") {
    const enabled = normalizeConfigValue(firstValue(
      payload.enabled,
      payload.value,
      payload.active,
      payload.status,
      payload.state,
      payload.on
    ));

    setSubbotHosting(enabled);

    return {
      subbotHosting: enabled,
      ...buildSubbotInfo()
    };
  }

  if (type === "get_groups") {
    const groups = await getGroupsCached(sock, true, true);

    return {
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups,
      cached: true,
      total: groups.length
    };
  }

  if (type === "set_config") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

    const key = normalizeConfigKey(firstValue(
      payload.key,
      payload.configKey,
      payload.config_key,
      payload.name,
      payload.setting,
      payload.option
    ));

    const value = firstValue(
      payload.value,
      payload.active,
      payload.enabled,
      payload.status,
      payload.state,
      payload.on,
      true
    );

    const data = await applyConfig(sock, chatId, key, value, true);
    const groups = await getGroupsCached(sock, true, true).catch(() => hydrateGroups(lastGroupsCache));

    return {
      ...data,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  if (type === "group_mode") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

    const mode = normalizeGroupMode(firstValue(
      payload.mode,
      payload.value,
      payload.status,
      payload.state
    ), task.rawType || task.type);

    const data = await applyGroupMode(sock, chatId, mode);

    lastGroupsAt = 0;

    const groups = await getGroupsCached(sock, true, true).catch(() => hydrateGroups(lastGroupsCache));

    return {
      ...data,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  if (type === "send_text") {
    const text = String(firstValue(
      payload.text,
      payload.message,
      payload.msg,
      payload.body,
      payload.content,
      payload.caption
    ) || "");

    const chatIds = parseChatIdsAny(
      payload.chatIds,
      payload.chat_ids,
      payload.groups,
      payload.groupIds,
      payload.group_ids,
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    );

    if (!text) throw new Error("Falta text/message");
    if (!chatIds.length) throw new Error("Falta chatId/chatIds");

    const results = [];

    for (const chatId of chatIds) {
      try {
        await sock.sendMessage(chatId, { text });
        results.push({ chatId, ok: true });
      } catch (e) {
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return {
      results,
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
  }

  if (type === "send_media") {
    const chatIds = parseChatIdsAny(
      payload.chatIds,
      payload.chat_ids,
      payload.groups,
      payload.groupIds,
      payload.group_ids,
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    );

    const caption = String(firstValue(payload.caption, payload.text, payload.message, "") || "");
    const fileName = String(firstValue(payload.fileName, payload.filename, payload.name, "archivo.bin") || "archivo.bin");
    const mimetype = String(firstValue(payload.mimetype, payload.mimeType, payload.mime, guessMimeFromName(fileName)) || "application/octet-stream");

    const fileData = firstValue(
      payload.fileBase64,
      payload.base64,
      payload.file,
      payload.data,
      payload.buffer,
      payload.media,
      payload.mediaBase64,
      payload.media_base64
    );

    if (!chatIds.length) throw new Error("Falta chatId/chatIds");

    const buffer = bufferFromAny(fileData);

    if (!buffer) throw new Error("Falta archivo/base64");

    let msgPayload;

    if (mimetype.startsWith("image/")) {
      msgPayload = { image: buffer, caption };
    } else if (mimetype.startsWith("video/")) {
      msgPayload = { video: buffer, caption, mimetype };
    } else if (mimetype.startsWith("audio/")) {
      msgPayload = {
        audio: buffer,
        mimetype,
        ptt: payload.ptt === true || String(payload.ptt || "").toLowerCase() === "true"
      };
    } else {
      msgPayload = {
        document: buffer,
        mimetype,
        fileName,
        caption
      };
    }

    const results = [];

    for (const chatId of chatIds) {
      try {
        await sock.sendMessage(chatId, msgPayload);
        results.push({ chatId, ok: true });
      } catch (e) {
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return {
      results,
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
  }

  if (type === "leave_group") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

    if (!chatId) throw new Error("Falta chatId");

    await sendGroupNotice(
      sock,
      chatId,
`╭━━━〔 👋 SUKI SE VA 〕━━━╮
┃ 💜 *Gracias por usarme*
╰━━━━━━━━━━━━━━━━━━━━━━╯

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.
Bye bye ✨🚀

${notificationFooter()}`
    );

    await sleep(1200);

    await sock.groupLeave(chatId);

    lastGroupsAt = 0;

    const groups = await getGroupsCached(sock, true, true).catch(() => hydrateGroups(lastGroupsCache));

    return {
      chatId,
      left: true,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  throw new Error(`Task desconocida: ${task.type}`);
}

function normalizeTasksFromPanel(data) {
  let tasks = [];

  if (Array.isArray(data?.tasks)) tasks = data.tasks;
  else if (Array.isArray(data?.data?.tasks)) tasks = data.data.tasks;
  else if (Array.isArray(data?.result?.tasks)) tasks = data.result.tasks;
  else if (data?.task && typeof data.task === "object") tasks = [data.task];
  else if (data?.data?.task && typeof data.data.task === "object") tasks = [data.data.task];

  return tasks
    .filter(Boolean)
    .map(t => normalizeTaskObject(t));
}

function logPollError() {}

async function executeAndReportTask(task) {
  task = normalizeTaskObject(task);

  const taskId = String(task?.id || "");

  if (!taskId) return;

  cleanupFinishedTasks();

  if (runningTaskIds.has(taskId)) return;
  if (finishedTaskIds.has(taskId)) return;

  runningTaskIds.add(taskId);

  try {
    const currentSock = getLiveSock();
    const result = await executeTask(currentSock, task);
    const reported = await reportTaskResult(taskId, true, result, "");

    if (reported) {
      finishedTaskIds.set(taskId, Date.now());
    }
  } catch (e) {
    const reported = await reportTaskResult(taskId, false, {}, e.message);

    if (reported) {
      finishedTaskIds.set(taskId, Date.now());
    }
  } finally {
    runningTaskIds.delete(taskId);
  }
}

async function postPollToPanel(body, label = "normal") {
  const res = await axios.post(`${SUKI_PANEL_URL}/api/bot/poll`, body, {
    timeout: 25000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });

  if (!res.data || res.data.ok !== true) {
    logPollError(`⚠️ Poll panel falló (${label}): ${res.status}`, res.data);

    return {
      ok: false,
      tasks: [],
      data: res.data || null,
      status: res.status
    };
  }

  const tasks = normalizeTasksFromPanel(res.data);

  return {
    ok: true,
    tasks,
    data: res.data,
    status: res.status
  };
}

async function relayPollOnce() {
  if (relayBusy) return;

  relayBusy = true;

  try {
    const sock = getSock();
    if (!sock) return;

    const keyHashes = getAllPanelHashes();

    if (!keyHashes.length) return;

    const state = await makeState(sock, false);

    if (!lastRegisterOkAt || Date.now() - lastRegisterOkAt > RELAY_REGISTER_INTERVAL_MS) {
      await registerWithPanel("before-poll", state).catch(() => {});
    }

    const pollId = String(Date.now()) + "_" + crypto.randomBytes(3).toString("hex");

    const body = {
      ...buildPanelBody("poll", state, {
        pollId,
        pollAt: Date.now(),
        rescuePending: true,
        takeAnyPending: true,
        allowHashRescue: true
      })
    };

    let poll = await postPollToPanel(body, "normal");

    if (!poll.ok) return;

    let tasks = poll.tasks;

    const debug = poll.data?.debug || {};
    const pendingTotal = Number(debug.pendingTotal || 0);
    const selected = Number(debug.selected || 0);

    if (!tasks.length && pendingTotal > 0 && selected === 0) {
      const rescueBody = {
        ...body,
        reason: "poll-rescue",
        rescuePoll: true,
        forceTakePending: true,
        takeAnyPending: true,
        allowHashRescue: true,
        pollId: pollId + "_rescue"
      };

      poll = await postPollToPanel(rescueBody, "rescue");

      if (poll.ok) {
        tasks = poll.tasks;
      }
    }

    saveRelayState({
      primaryKeyHash: getPrimaryKeyHash(),
      keyHashes,
      lastPollAt: Date.now(),
      lastPollId: pollId,
      lastPollTasks: tasks.length,
      lastPollGroupsSent: Array.isArray(body.groups) ? body.groups.length : 0,
      lastPanelDebug: poll.data?.debug || null
    });

    if (!tasks.length) return;

    for (const task of tasks) {
      await executeAndReportTask(task);
    }
  } catch {
  } finally {
    relayBusy = false;
  }
}

function startRelayPolling() {
  if (relayStarted) return;

  relayStarted = true;

  setTimeout(() => registerWithPanel("startup").catch(() => {}), 2000);
  setInterval(() => registerWithPanel("refresh").catch(() => {}), RELAY_REGISTER_INTERVAL_MS);

  setTimeout(() => relayPollOnce().catch(() => {}), 5000);
  setInterval(() => relayPollOnce().catch(() => {}), RELAY_POLL_INTERVAL_MS);
}

function makeJsonBodyLimit(app) {
  app.use(express.json({ limit: "80mb" }));
  app.use(express.urlencoded({ extended: true, limit: "80mb" }));
}

function startWebServer(sock) {
  global.sukiSock = sock;
  global.sock = sock;

  setInitialPublicBaseUrl();

  global.__SUKI_RELAY_REGISTER_NOW = (reason = "manual-global") => {
    return registerWithPanel(reason).catch(() => false);
  };

  global.__SUKI_RELAY_POLL_NOW = () => {
    return relayPollOnce().catch(() => false);
  };

  if (global.__SUKI_WEB_SERVER_STARTED) {
    startRelayPolling();
    return;
  }

  global.__SUKI_WEB_SERVER_STARTED = true;

  const app = express();
  const PORT = getServerPort();

  app.set("trust proxy", 1);

  app.use(cors());
  makeJsonBodyLimit(app);

  app.use((req, res, next) => {
    updatePublicBaseUrl(req);
    next();
  });

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      name: "La Suki Bot API",
      status: "online",
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      detectedIp: getServerIp() || null,
      port: PORT,
      pollIntervalMs: RELAY_POLL_INTERVAL_MS,
      groupsCacheMs: GROUPS_CACHE_MS,
      groupsForceCooldownMs: GROUPS_FORCE_COOLDOWN_MS,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length,
      allPanelHashes: getAllPanelHashes().map(shortHash),
      groupsCache: lastGroupsCache.length
    });
  });

  app.get("/api/status", authMiddleware, async (req, res) => {
    const currentSock = getSock();

    res.json({
      ok: true,
      connected: !!currentSock?.user,
      user: currentSock?.user || null,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      detectedIp: getServerIp() || null,
      port: PORT,
      pollIntervalMs: RELAY_POLL_INTERVAL_MS,
      groupsCache: lastGroupsCache.length,
      groupsLastUpdate: lastGroupsAt || null,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length,
      allPanelHashes: getAllPanelHashes().map(shortHash),
      runningTasks: Array.from(runningTaskIds),
      finishedTasksCount: finishedTaskIds.size,
      relayState: readRelayState()
    });
  });

  app.post("/api/register-now", authMiddleware, async (req, res) => {
    const ok = await registerWithPanel("manual-api");

    res.json({
      ok,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length,
      allPanelHashes: getAllPanelHashes().map(shortHash),
      groupsCache: lastGroupsCache.length
    });
  });

  app.post("/api/poll-now", authMiddleware, async (req, res) => {
    try {
      await relayPollOnce();

      res.json({
        ok: true,
        message: "Poll ejecutado manualmente",
        primaryKeyHash: shortHash(getPrimaryKeyHash()),
        activeKeys: getActiveKeyHashes().length,
        allPanelHashes: getAllPanelHashes().map(shortHash),
        groupsCache: lastGroupsCache.length,
        relayState: readRelayState()
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.get("/api/groups", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();
      const force = req.query.force === "1" || req.query.refresh === "1";
      const groups = await getGroupsCached(currentSock, force, force);

      res.json({
        ok: true,
        total: groups.length,
        cached: true,
        groups
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
        cachedGroups: lastGroupsCache.length
      });
    }
  });

  app.post("/api/groups/:chatId/group-mode", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = normalizeChatId(req.params.chatId);
      const mode = String(req.body?.mode || "");

      const result = await applyGroupMode(currentSock, chatId, mode);

      lastGroupsAt = 0;

      res.json({
        ok: true,
        ...result
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.get("/api/groups/:chatId/config", authMiddleware, async (req, res) => {
    try {
      const chatId = normalizeChatId(req.params.chatId);
      const config = readGroupConfig(chatId);

      res.json({
        ok: true,
        chatId,
        config
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/config", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = normalizeChatId(req.params.chatId);
      const { key, value } = req.body || {};

      const result = await applyConfig(
        currentSock,
        chatId,
        String(key || ""),
        value,
        true
      );

      res.json({
        ok: true,
        ...result
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/text", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const text = String(firstValue(
        req.body?.text,
        req.body?.message,
        req.body?.msg,
        req.body?.body,
        req.body?.content
      ) || "");

      const chatIds = parseChatIdsAny(
        req.body.chatIds,
        req.body.chat_ids,
        req.body.groups,
        req.body.groupIds,
        req.body.group_ids,
        req.body.chatId,
        req.body.chat_id,
        req.body.groupId,
        req.body.group_id,
        req.body.jid,
        req.body.remoteJid
      );

      if (!chatIds.length) {
        return res.status(400).json({
          ok: false,
          error: "Falta chatId o chatIds"
        });
      }

      if (!text) {
        return res.status(400).json({
          ok: false,
          error: "Falta text"
        });
      }

      const results = [];

      for (const chatId of chatIds) {
        try {
          await currentSock.sendMessage(chatId, { text });
          results.push({ chatId, ok: true });
        } catch (e) {
          results.push({ chatId, ok: false, error: e.message });
        }
      }

      res.json({
        ok: true,
        results,
        total: results.length,
        success: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/media", authMiddleware, upload.single("file"), async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatIds = parseChatIdsAny(
        req.body.chatIds,
        req.body.chat_ids,
        req.body.groups,
        req.body.groupIds,
        req.body.group_ids,
        req.body.chatId,
        req.body.chat_id,
        req.body.groupId,
        req.body.group_id,
        req.body.jid,
        req.body.remoteJid
      );

      const caption = String(req.body.caption || "");

      if (!chatIds.length) {
        return res.status(400).json({
          ok: false,
          error: "Falta chatId o chatIds"
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          ok: false,
          error: "Falta archivo"
        });
      }

      const mimetype = req.file.mimetype || guessMimeFromName(req.file.originalname || "");
      const buffer = req.file.buffer;
      const fileName = req.file.originalname || "archivo.bin";

      let payload;

      if (mimetype.startsWith("image/")) {
        payload = { image: buffer, caption };
      } else if (mimetype.startsWith("video/")) {
        payload = { video: buffer, caption, mimetype };
      } else if (mimetype.startsWith("audio/")) {
        payload = {
          audio: buffer,
          mimetype,
          ptt: false
        };
      } else {
        payload = {
          document: buffer,
          mimetype: mimetype || "application/octet-stream",
          fileName,
          caption
        };
      }

      const results = [];

      for (const chatId of chatIds) {
        try {
          await currentSock.sendMessage(chatId, payload);
          results.push({ chatId, ok: true });
        } catch (e) {
          results.push({ chatId, ok: false, error: e.message });
        }
      }

      res.json({
        ok: true,
        results,
        total: results.length,
        success: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/leave", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = normalizeChatId(req.params.chatId);

      await sendGroupNotice(
        currentSock,
        chatId,
`╭━━━〔 👋 SUKI SE VA 〕━━━╮
┃ 💜 *Gracias por usarme*
╰━━━━━━━━━━━━━━━━━━━━━━╯

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.
Bye bye ✨🚀

${notificationFooter()}`
      );

      await sleep(1200);

      await currentSock.groupLeave(chatId);

      lastGroupsAt = 0;

      const groups = await getGroupsCached(currentSock, true, true).catch(() => hydrateGroups(lastGroupsCache));

      res.json({
        ok: true,
        chatId,
        left: true,
        groups
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log("🌐 API web de La Suki Bot activa en puerto " + PORT);
    console.log("🌐 Panel central:", SUKI_PANEL_URL);
    console.log("🌍 Public URL detectada:", getPublicBaseUrl() || "sin detectar todavía");
    console.log("🧩 IP detectada:", getServerIp() || "sin IP env");
    console.log("🔁 Modo relay/polling listo.");
    console.log("⏱️ Polling configurado cada " + (RELAY_POLL_INTERVAL_MS / 1000) + " segundos.");
    console.log("♻️ Caché de grupos: " + (GROUPS_CACHE_MS / 1000) + "s");
    console.log("🛡️ Cooldown force grupos: " + (GROUPS_FORCE_COOLDOWN_MS / 1000) + "s");
    console.log("🔑 Primary hash:", shortHash(getPrimaryKeyHash()));
    console.log("🔑 Keys activas:", getActiveKeyHashes().length);
    console.log("🔑 Hashes conocidos:", getAllPanelHashes().map(shortHash).join(", ") || "ninguno");

    startRelayPolling();
  });
}

export {
  startWebServer
};
