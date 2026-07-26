
// comandos/groq.js — GROQ AI (Auto Chat ON/OFF por grupo)
// ✅ .groq on / .groq off
// ✅ Auto responde en el grupo por 10 min
// ✅ Guarda estado en JSON (persistente)
// ✅ Responde SOLO texto de la IA (sin publicidad)
// ✅ Listener global tipo play.js

"use strict";

import { canal } from "../../disenos.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

const TTL_MS = 10 * 60 * 1000; // 10 minutos
const COOLDOWN_MS = 1200;      // anti-spam mínimo (igual responde “a cada texto”, solo evita flood brutal)

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "groq_auto.json");

// ----------------- Persistencia -----------------
function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadState() {
  ensureDataDir();
  try {
    if (!fs.existsSync(STATE_FILE)) return { chats: {} };
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const j = JSON.parse(raw || "{}");
    if (!j || typeof j !== "object") return { chats: {} };
    if (!j.chats || typeof j.chats !== "object") j.chats = {};
    return j;
  } catch {
    return { chats: {} };
  }
}

function saveState(state) {
  ensureDataDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

function isExpired(chatState) {
  return !chatState || !chatState.until || Date.now() > Number(chatState.until);
}

function cleanExpired(state) {
  const now = Date.now();
  let changed = false;
  for (const [jid, st] of Object.entries(state.chats || {})) {
    if (!st || !st.until || now > Number(st.until)) {
      delete state.chats[jid];
      changed = true;
    }
  }
  if (changed) saveState(state);
}

// ----------------- API call -----------------
function pickTextFromApi(data) {
  // Tu API: res.success({ prompt, result, model... })
  // => respuesta: { status:true, result:{ prompt, result: "texto", ... } }
  const txt = data?.result?.result;
  return (typeof txt === "string" ? txt : "").trim();
}

async function askGroq(prompt) {
  const { data, status: http } = await axios.post(
    `${API_BASE}/ai`,
    { prompt },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: (s) => s >= 200 && s < 600,
    }
  );

  if (http !== 200) throw new Error(`HTTP ${http}${data?.message ? ` - ${data.message}` : ""}`);
  if (!data || data.status !== true) throw new Error(data?.message || "La API no respondió correctamente.");

  const text = pickTextFromApi(data);
  if (!text) throw new Error("La API respondió pero no trajo texto.");

  return text;
}

// ----------------- Utils WA -----------------
function getText(m) {
  return (
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.message?.imageMessage?.caption ||
    m?.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function isGroupJid(jid = "") {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function chunkText(s, n = 3500) {
  const out = [];
  const str = String(s || "");
  for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
  return out;
}

// ----------------- Listener global -----------------
function ensureGroqAutoListener(conn) {
  if (conn._groqAutoListener) return;
  conn._groqAutoListener = true;

  conn.ev.on("messages.upsert", async (ev) => {
    try {
      const state = loadState();
      cleanExpired(state);

      for (const m of ev.messages || []) {
        try {
          const chatId = m?.key?.remoteJid;
          if (!chatId) continue;
          if (!isGroupJid(chatId)) continue;

          // ignore mensajes del propio bot
          if (m?.key?.fromMe) continue;

          const st = state.chats?.[chatId];
          if (!st || isExpired(st)) {
            if (st) {
              delete state.chats[chatId];
              saveState(state);
            }
            continue;
          }

          // solo texto
          const text = getText(m);
          if (!text) continue;

          // no responder a comandos
          const pref = (global.prefixes && global.prefixes[0]) || ".";
          if (text.startsWith(pref)) continue;

          // anti-flood básico
          const now = Date.now();
          if (st.busy) continue;
          if (st.lastAt && now - Number(st.lastAt) < COOLDOWN_MS) continue;

          // marcar busy
          st.busy = true;
          st.lastAt = now;
          state.chats[chatId] = st;
          saveState(state);

          // pedir a la IA
          let reply = "";
          try {
            reply = await askGroq(text);
          } catch (e) {
            // si falla, no spamear errores; solo libera busy y sigue
            st.busy = false;
            state.chats[chatId] = st;
            saveState(state);
            continue;
          }

          // enviar SOLO texto (sin branding)
          const parts = chunkText(reply, 3500);
          for (const p of parts) {
            await conn.sendMessage(chatId, {
      contextInfo: canal(), text: p }, { quoted: m });
          }

          // liberar busy
          st.busy = false;
          state.chats[chatId] = st;
          saveState(state);

          // auto-off si ya expiró justo después
          if (Date.now() > Number(st.until)) {
            delete state.chats[chatId];
            saveState(state);
          }
        } catch {}
      }
    } catch (err) {
      console.error("groq auto listener error:", err?.message || err);
    }
  });
}

// ----------------- Command handler -----------------
const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref   = (global.prefixes && global.prefixes[0]) || ".";

  // asegurar listener siempre
  ensureGroqAutoListener(conn);

  if (!isGroupJid(chatId)) {
    return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "❌ Este modo solo funciona en grupos." }, { quoted: msg });
  }

  const sub = String(args?.[0] || "").toLowerCase().trim();
  const state = loadState();
  cleanExpired(state);

  if (!sub || (sub !== "on" && sub !== "off")) {
    const st = state.chats?.[chatId];
    const active = !!st && !isExpired(st);
    const left = active ? Math.max(0, Number(st.until) - Date.now()) : 0;
    const mins = active ? Math.ceil(left / 60000) : 0;

    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text:
`🤖 *GROQ AI — AutoChat*
✳️ Usa:
- ${pref}${command} on   (activa 10 min)
- ${pref}${command} off  (desactiva)

Estado: ${active ? `✅ ACTIVO (${mins} min aprox)` : "⛔ APAGADO"}`
    }, { quoted: msg });
  }

  if (sub === "on") {
    state.chats[chatId] = {
      until: Date.now() + TTL_MS,
      by: msg?.key?.participant || msg?.participant || "",
      busy: false,
      lastAt: 0,
    };
    saveState(state);

    return conn.sendMessage(chatId, {
      contextInfo: canal(),
      text: "✅ Groq AutoChat *ACTIVADO* por 10 minutos.\n(Responderé a los mensajes del grupo automáticamente.)"
    }, { quoted: msg });
  }

  // off
  if (state.chats?.[chatId]) {
    delete state.chats[chatId];
    saveState(state);
  }

  return conn.sendMessage(chatId, {
      contextInfo: canal(), text: "⛔ Groq AutoChat *DESACTIVADO*." }, { quoted: msg });
};

handler.command = ["groq"];
handler.help = ["groq on", "groq off"];
handler.tags = ["tools"];
handler.register = true;

export default handler;
