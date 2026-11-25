import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
// plugins/Ssa.js — Sticker con audio (estático o animado)
// Comandos: .ssa / .ss
//
// Crea un sticker que suena al tocarlo (máx. 60 s de audio, igual al largo del sticker), con la misma
// leyenda del comando .s (quién lo mandó hacer, bot creador y fecha).
//
//  • Video  → sticker animado con el audio del propio video (todo en 1 paso).
//  • Imagen / sticker → abre una sesión de 60 s; manda o responde un
//    audio / nota de voz / video y el bot lo pega al sticker.
//  • Imagen con .ssa respondiendo a un audio → se une directo.
//
// Basado en "Audio Sticker" de Nimzz, adaptado a La Suki Bot.
import fs from 'fs';
import path from 'path';
import Crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import webp from 'node-webpmux';
import { canal } from "../disenos.js";

const execFileAsync = promisify(execFile);
const MAX_DURATION = 60;      // segundos máximos de audio / video
const SESSION_SECONDS = 60;   // tiempo para mandar el audio
const MAX_STICKER_BYTES = 900 * 1024;

// === Carpeta temporal ===
const tempFolder = path.join(__dirname, "../tmp/");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

// Sesiones activas: "chat:remitente" → { stickerBuffer, isAnimated, conn, ... }
const sessions = new Map();
// Sockets (bot principal / subbots) que ya tienen el listener de audio
const listening = new WeakSet();

// === Baileys (import dinámico, igual que otros plugins) ===
let baileysMod = null;
async function getBaileys() {
  if (baileysMod) return baileysMod;
  const mod = await import("@whiskeysockets/baileys");
  baileysMod = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;
  return baileysMod;
}

// === Helpers ===
function randomFileName(ext) {
  return `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`;
}

function unwrapMessage(m) {
  let n = m;
  for (let i = 0; i < 6 && n; i++) {
    const next =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message ||
      n.documentWithCaptionMessage?.message ||
      n.editedMessage?.message;
    if (!next) break;
    n = next;
  }
  return n || {};
}

function getContextInfo(content) {
  for (const v of Object.values(content || {})) {
    if (v && typeof v === "object" && v.contextInfo) return v.contextInfo;
  }
  return null;
}

function getText(content) {
  return String(
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    ""
  ).trim();
}

// Detecta qué media trae un mensaje (ya desenvuelto)
function detectMedia(content) {
  if (!content) return null;
  if (content.videoMessage) {
    const n = content.videoMessage;
    return { kind: "video", node: n, dlType: "video", mime: n.mimetype || "video/mp4", seconds: Number(n.seconds || 0) };
  }
  if (content.imageMessage) {
    return { kind: "image", node: content.imageMessage, dlType: "image", mime: content.imageMessage.mimetype || "image/jpeg", seconds: 0 };
  }
  if (content.stickerMessage) {
    return { kind: "webp", node: content.stickerMessage, dlType: "sticker", mime: "image/webp", seconds: 0, isAnimated: !!content.stickerMessage.isAnimated };
  }
  if (content.audioMessage) {
    const n = content.audioMessage;
    return { kind: "audio", node: n, dlType: "audio", mime: n.mimetype || "audio/ogg", seconds: Number(n.seconds || 0) };
  }
  if (content.documentMessage) {
    const n = content.documentMessage;
    const mime = String(n.mimetype || "").toLowerCase();
    if (/^audio\//.test(mime)) return { kind: "audio", node: n, dlType: "document", mime, seconds: 0 };
    if (/^video\//.test(mime)) return { kind: "video", node: n, dlType: "document", mime, seconds: 0 };
    if (/^image\//.test(mime)) return { kind: /webp/.test(mime) ? "webp" : "image", node: n, dlType: "document", mime, seconds: 0 };
  }
  return null;
}

const isVisual = (i) => i && (i.kind === "image" || i.kind === "video" || i.kind === "webp");
const isAudioish = (i) => i && (i.kind === "audio" || i.kind === "video");

async function downloadMedia(conn, info) {
  let downloadContentFromMessage = conn?.wa?.downloadContentFromMessage || global.wa?.downloadContentFromMessage;
  if (!downloadContentFromMessage) downloadContentFromMessage = (await getBaileys()).downloadContentFromMessage;
  const stream = await downloadContentFromMessage(info.node, info.dlType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function audioExt(info) {
  if (info.kind === "video") return "mp4";
  if (/ogg|opus/i.test(info.mime)) return "ogg";
  if (/mp4|m4a|aac/i.test(info.mime)) return "m4a";
  if (/wav/i.test(info.mime)) return "wav";
  return "mp3";
}

// === Leyenda (misma lógica que el comando .s) ===
function stickerMetadata(msg) {
  const senderName = msg.pushName || "Usuario Desconocido";
  const fecha = new Date();
  const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()} ${fecha.getHours()}:${fecha.getMinutes()}`;
  return {
    packname: `✨ Lo Mandó Hacer: ${senderName}`,
    author: `🦋Bot Creador: ❦La Suki 3.0 Bot❦\n🛠️ Desarrollado por: Russell XZ 💻\n📅 ${fechaStr}`,
    categories: ["🔊"],
  };
}

async function addExif(webpBuffer, metadata) {
  const json = {
    "sticker-pack-id": "suki-3.0",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    emojis: metadata.categories || [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00
  ]);

  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(webpBuffer);
  img.exif = exif;
  return await img.save(null);
}

function isWebpAnimated(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return false;
  if (buf.toString("ascii", 12, 16) === "VP8X" && (buf[20] & 0x02) !== 0) return true;
  return buf.includes(Buffer.from("ANMF"));
}

// === Conversión a webp ===
const VF_BASE = "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1";

async function imageToWebp(media) {
  const tmpIn = path.join(tempFolder, randomFileName("jpg"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  try {
    fs.writeFileSync(tmpIn, media);
    await execFileAsync("ffmpeg", [
      "-y", "-i", tmpIn,
      "-vf", VF_BASE,
      "-c:v", "libwebp", "-lossless", "0", "-q:v", "80",
      "-frames:v", "1", "-an",
      tmpOut
    ]);
    return fs.readFileSync(tmpOut);
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
}

async function videoToWebp(media, seconds = MAX_DURATION) {
  const tmpIn = path.join(tempFolder, randomFileName("mp4"));
  const tmpOut = path.join(tempFolder, randomFileName("webp"));
  try {
    fs.writeFileSync(tmpIn, media);
    // Se baja calidad / fps hasta que el sticker pese lo que acepta WhatsApp
    // (con 60 s hace falta bajar también el tamaño para no pasarse)
    const perfiles = [[10, 50, 512], [8, 36, 512], [6, 24, 512], [5, 16, 384], [4, 10, 320]];
    let out = null;
    for (const [fps, q, size] of perfiles) {
      const vf = size === 512 ? VF_BASE : VF_BASE.replace(/512/g, String(size));
      await execFileAsync("ffmpeg", [
        "-y", "-i", tmpIn,
        "-t", String(seconds),
        "-vf", `fps=${fps},${vf}`,
        "-c:v", "libwebp", "-lossless", "0", "-compression_level", "6",
        "-q:v", String(q), "-loop", "0", "-preset", "picture",
        "-an", "-vsync", "0",
        tmpOut
      ], { maxBuffer: 1024 * 1024 * 20 });
      out = fs.readFileSync(tmpOut);
      if (out.length <= MAX_STICKER_BYTES) break;
    }
    return out;
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
}

async function buildSticker(buffer, kind, metadata, seconds = MAX_DURATION) {
  let raw = buffer;
  if (kind === "video") raw = await videoToWebp(buffer, seconds);
  else if (kind === "image") raw = await imageToWebp(buffer);
  return await addExif(raw, metadata);
}

// === Audio → OGG/Opus (nota de voz) ===
function parseFfmpegDuration(stderr) {
  const matches = [...String(stderr || "").matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!matches.length) return 0;
  const last = matches[matches.length - 1];
  const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Number.isFinite(sec) ? sec : 0;
}

async function toOggOpus(buffer, ext, maxSeconds = MAX_DURATION) {
  const tmpIn = path.join(tempFolder, randomFileName(ext));
  const tmpOut = path.join(tempFolder, randomFileName("ogg"));
  try {
    fs.writeFileSync(tmpIn, buffer);
    let stderr = "";
    try {
      ({ stderr } = await execFileAsync("ffmpeg", [
        "-y", "-i", tmpIn,
        "-vn", "-map", "0:a:0",
        "-t", String(maxSeconds),
        "-af", "aresample=48000:async=1:first_pts=0",
        "-c:a", "libopus", "-b:a", "48k", "-vbr", "on",
        "-compression_level", "10", "-ac", "1", "-ar", "48000",
        "-application", "audio", "-avoid_negative_ts", "make_zero",
        "-f", "ogg", tmpOut
      ], { maxBuffer: 1024 * 1024 * 20 }));
    } catch {
      throw new Error("NO_AUDIO");
    }
    const ogg = fs.readFileSync(tmpOut);
    if (!ogg || ogg.length < 200) throw new Error("NO_AUDIO");
    return { ogg, realSeconds: parseFfmpegDuration(stderr) };
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
}

// El audio del sticker NO es nota de voz: va como audio normal (ptt: false),
// igual que los stickers con sonido que manda WhatsApp.
// maxSeconds = lo que dura el sticker (video animado), así el audio se ajusta a él.
async function buildAudioMessage(conn, buffer, ext, fallbackSeconds = 0, maxSeconds = MAX_DURATION) {
  const { prepareWAMessageMedia } = await getBaileys();
  const limit = Math.max(1, Math.min(MAX_DURATION, Math.round(maxSeconds) || MAX_DURATION));
  const { ogg, realSeconds } = await toOggOpus(buffer, ext, limit);

  const { audioMessage } = await prepareWAMessageMedia(
    { audio: ogg, mimetype: "audio/ogg; codecs=opus", ptt: false },
    { upload: conn.waUploadToServer }
  );
  if (!audioMessage) throw new Error("WhatsApp no aceptó la subida del audio.");

  const sec = realSeconds > 0 ? realSeconds : fallbackSeconds > 0 ? fallbackSeconds : 5;
  audioMessage.seconds = Math.max(1, Math.min(limit, Math.round(sec)));
  audioMessage.ptt = false;
  audioMessage.mimetype = "audio/ogg; codecs=opus";
  return audioMessage;
}

// === Parche de proto: stickerMessage.audioMessage (26) y audioStickerMessage (134) ===
// ultra-baileys no conoce estos dos campos; se añaden al codificador:
//   StickerMessage.audioMessage -> campo 26  (tag 210  = 26 << 3 | 2)
//   Message.audioStickerMessage -> campo 134 (tag 1074 = 134 << 3 | 2, FutureProofMessage)
function patchProto(p) {
  const M = p?.Message;
  if (!M || M.__sukiAudioStickerPatched) return;
  if (!M.StickerMessage || !M.AudioMessage || !M.FutureProofMessage) return;

  const prevStickerEncode = M.StickerMessage.encode;
  M.StickerMessage.encode = function (message, writer) {
    const w = prevStickerEncode.call(this, message, writer);
    if (message?.audioMessage != null) {
      M.AudioMessage.encode(message.audioMessage, w.uint32(210).fork()).ldelim();
    }
    return w;
  };

  const prevMsgEncode = M.encode;
  M.encode = function (message, writer) {
    const w = prevMsgEncode.call(this, message, writer);
    if (message?.audioStickerMessage != null) {
      M.FutureProofMessage.encode(message.audioStickerMessage, w.uint32(1074).fork()).ldelim();
    }
    return w;
  };

  M.__sukiAudioStickerPatched = true;
}

async function ensurePatched() {
  const mod = await getBaileys();
  patchProto(mod?.proto);
  if (mod?.default?.proto && mod.default.proto !== mod.proto) patchProto(mod.default.proto);
}

// Donde termina el primer fotograma (chunk ANMF) de un webp animado.
function firstFrameLength(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourcc = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
    if (fourcc === "ANMF") return offset;
  }
  return null;
}

// Duración real de un video (para que el audio dure lo mismo que el sticker).
async function videoSeconds(buffer, fallback = 0) {
  const tmpIn = path.join(tempFolder, randomFileName("mp4"));
  try {
    fs.writeFileSync(tmpIn, buffer);
    const r = await execFileAsync("ffmpeg", ["-hide_banner", "-i", tmpIn]).catch((e) => e);
    const m = String(r?.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const sec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    return sec > 0 ? sec : fallback;
  } catch {
    return fallback;
  } finally {
    fs.rmSync(tmpIn, { force: true });
  }
}

// Forma en el cable (la de los stickers con sonido de WhatsApp):
//   { audioStickerMessage: { message: { stickerMessage: { ...sticker, audioMessage } } },
//     messageContextInfo: { messageSecret } }
async function sendAudioSticker(conn, chatId, stickerBuffer, isAnimated, audioMessage, quoted = null) {
  await ensurePatched();
  const { prepareWAMessageMedia, generateMessageIDV2, generateMessageID } = await getBaileys();

  const prepared = await prepareWAMessageMedia(
    { sticker: stickerBuffer },
    { upload: conn.waUploadToServer }
  );
  const sticker = prepared?.stickerMessage;
  if (!sticker) throw new Error("WhatsApp no aceptó la subida del sticker.");

  sticker.isAnimated = Boolean(isAnimated);
  const frame = isAnimated ? firstFrameLength(stickerBuffer) : null;
  if (frame) sticker.firstFrameLength = frame;

  if (quoted?.key?.id && quoted.message) {
    sticker.contextInfo = {
      stanzaId: quoted.key.id,
      participant: quoted.key.participant || quoted.key.remoteJid || undefined,
      quotedMessage: quoted.message,
    };
  }

  sticker.audioMessage = { ...audioMessage, mimetype: "audio/ogg; codecs=opus", ptt: false };

  const payload = {
    audioStickerMessage: { message: { stickerMessage: sticker } },
    messageContextInfo: { messageSecret: Crypto.randomBytes(32) }
  };

  const messageId = typeof generateMessageIDV2 === "function"
    ? generateMessageIDV2(conn.user?.id)
    : typeof generateMessageID === "function" ? generateMessageID() : undefined;

  await conn.relayMessage(chatId, payload, messageId ? { messageId } : {});
}

// === Sesiones ===
const react = (conn, msg, text) =>
  conn.sendMessage(msg.key.remoteJid, { react: { text, key: msg.key } }).catch(() => {});

const say = (conn, msg, text) =>
  conn.sendMessage(msg.key.remoteJid, { contextInfo: canal(), text }, { quoted: msg }).catch(() => {});

function sessionKey(msg) {
  const chat = msg.key.remoteJid;
  const sender = msg.key.participant || msg.participant || chat;
  return `${chat}:${String(sender).split(":")[0].split("@")[0]}`;
}

function clearSession(key) {
  const s = sessions.get(key);
  if (s?.timer) clearTimeout(s.timer);
  sessions.delete(key);
}

function startSession(conn, msg, stickerBuffer, isAnimated, pref, command, visualSeconds = MAX_DURATION) {
  const key = sessionKey(msg);
  clearSession(key);
  attachListener(conn);

  const timer = setTimeout(() => {
    if (!sessions.has(key)) return;
    sessions.delete(key);
    say(conn, msg,
      `⏰ *Se acabó el tiempo del sticker con audio.*\n\n` +
      `Pasaron ${SESSION_SECONDS} segundos sin recibir audio. Vuelve a usar *${pref}${command}* si quieres intentarlo otra vez.`
    );
  }, SESSION_SECONDS * 1000);

  sessions.set(key, {
    conn,
    stickerBuffer,
    isAnimated,
    visualSeconds,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
    processing: false,
    timer
  });

  return say(conn, msg,
    `🔊 *STICKER CON AUDIO*\n\n` +
    `✅ Ya guardé tu sticker (${isAnimated ? "animado" : "estático"}).\n` +
    `⏳ Tienes *${SESSION_SECONDS} segundos* para:\n\n` +
    `1️⃣ Mandar un *audio, nota de voz o video* aquí, o\n` +
    `2️⃣ Responder a un audio con *${pref}${command}*\n\n` +
    `🎧 Máximo *${MAX_DURATION} segundos* de audio.\n` +
    `❌ Para cancelar: *${pref}${command} cancelar*`
  );
}

async function consumeSession(conn, msg, session, audioInfo) {
  const key = sessionKey(msg);
  session.processing = true;
  await react(conn, msg, "🛠️");
  try {
    const buf = await downloadMedia(conn, audioInfo);
    if (!buf.length) throw new Error("No se pudo descargar el audio.");
    const audioMessage = await buildAudioMessage(conn, buf, audioExt(audioInfo), audioInfo.seconds, session.visualSeconds);
    await sendAudioSticker(conn, msg.key.remoteJid, session.stickerBuffer, session.isAnimated, audioMessage, msg);
    clearSession(key);
    await react(conn, msg, "✅");
  } catch (err) {
    session.processing = false;
    console.error("[ssa] Error uniendo audio:", err);
    await react(conn, msg, "❌");
    await say(conn, msg,
      err?.message === "NO_AUDIO"
        ? "❌ *Ese archivo no tiene audio.* Manda otro audio o nota de voz."
        : "❌ *Hubo un error al ponerle el audio al sticker.*"
    );
  }
}

// Escucha audios mandados directo (sin comando) mientras hay sesión abierta
function attachListener(conn) {
  if (!conn?.ev?.on || listening.has(conn)) return;
  listening.add(conn);

  conn.ev.on("messages.upsert", async ({ messages }) => {
    if (!sessions.size) return;
    for (const msg of messages || []) {
      try {
        if (!msg?.message || !msg.key?.remoteJid) continue;
        const key = sessionKey(msg);
        const session = sessions.get(key);
        if (!session || session.conn !== conn || session.processing) continue;
        if (Date.now() > session.expiresAt) { clearSession(key); continue; }

        const content = unwrapMessage(msg.message);
        const text = getText(content);
        // Si escribe el comando lo maneja el handler, no el listener
        if (text && (global.prefixes || ["."]).some((p) => text.startsWith(p))) continue;

        const info = detectMedia(content);
        if (!isAudioish(info)) continue;

        await consumeSession(conn, msg, session, info);
      } catch (e) {
        console.error("[ssa] Error en listener:", e);
      }
    }
  });
}

// === Comando principal ===
const handler = async (msg, { conn, text, command, usedPrefix }) => {
  const chatId = msg.key.remoteJid;
  const pref = usedPrefix || global.prefixes?.[0] || ".";
  command = command || "ssa";

  const content = unwrapMessage(msg.message);
  const ctx = getContextInfo(content);
  const quoted = ctx?.quotedMessage ? unwrapMessage(ctx.quotedMessage) : null;

  const own = detectMedia(content);
  const quot = detectMedia(quoted);

  const key = sessionKey(msg);
  const session = sessions.get(key);
  const arg = String(text || "").trim().toLowerCase();

  // Cancelar sesión
  if (/^(cancelar|cancel|stop|batal)$/.test(arg)) {
    if (!session) return say(conn, msg, "⚠️ *No tienes ningún sticker con audio pendiente.*");
    clearSession(key);
    await react(conn, msg, "✅");
    return say(conn, msg, "✅ *Sticker con audio cancelado.*");
  }

  // Hay sesión y responde a un audio/video → unir
  if (session && session.conn === conn && !session.processing && !isVisual(own) && isAudioish(quot)) {
    return consumeSession(conn, msg, session, quot);
  }

  const visual = isVisual(own) ? own : isVisual(quot) ? quot : null;

  if (!visual) {
    if (session && session.conn === conn) {
      const rest = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
      return say(conn, msg,
        `⏳ *Tu sticker sigue esperando audio (${rest}s).*\n\n` +
        `Manda un audio / nota de voz o responde a uno con *${pref}${command}*.\n` +
        `❌ Para cancelar: *${pref}${command} cancelar*`
      );
    }
    if (quot?.kind === "audio") {
      return say(conn, msg,
        `⚠️ *Primero necesito la imagen.*\n\n` +
        `Responde a una *imagen, sticker o video* con *${pref}${command}* y luego mándame el audio.`
      );
    }
    return say(conn, msg,
      `⚠️ *Responde a una imagen, sticker o video para crear un sticker con audio.*\n\n` +
      `✳️ *Con video:* responde al video con *${pref}${command}* y sale el sticker animado con su sonido.\n\n` +
      `✳️ *Con imagen o sticker:* responde con *${pref}${command}* y después manda (o responde) el audio / nota de voz.\n\n` +
      `🎧 Máximo *${MAX_DURATION} segundos* de audio.`
    );
  }

  try {
    await react(conn, msg, "🛠️");

    const visualBuf = await downloadMedia(conn, visual);
    if (!visualBuf.length) throw new Error("No se pudo descargar la imagen/video.");

    const metadata = stickerMetadata(msg);
    // Con video el sticker dura lo que el video (hasta 60 s) y el audio se ajusta a eso.
    const visualSeconds = visual.kind === "video"
      ? Math.max(1, Math.min(MAX_DURATION, Math.round(await videoSeconds(visualBuf, visual.seconds || MAX_DURATION))))
      : MAX_DURATION;
    const stickerBuffer = await buildSticker(visualBuf, visual.kind, metadata, visualSeconds);
    const isAnimated = visual.kind === "video" || isWebpAnimated(stickerBuffer);

    // Imagen/video propio + respondiendo a un audio → directo
    if (visual === own && quot?.kind === "audio") {
      const audioBuf = await downloadMedia(conn, quot);
      const audioMessage = await buildAudioMessage(conn, audioBuf, audioExt(quot), quot.seconds, visualSeconds);
      await sendAudioSticker(conn, chatId, stickerBuffer, isAnimated, audioMessage, msg);
      clearSession(key);
      return react(conn, msg, "✅");
    }

    // Video → usa su propio audio
    if (visual.kind === "video") {
      try {
        const audioMessage = await buildAudioMessage(conn, visualBuf, "mp4", visual.seconds, visualSeconds);
        await sendAudioSticker(conn, chatId, stickerBuffer, true, audioMessage, msg);
        clearSession(key);
        return react(conn, msg, "✅");
      } catch (e) {
        if (e?.message !== "NO_AUDIO") throw e;
        // El video no tiene sonido → pedir un audio
        await react(conn, msg, "🎧");
        return startSession(conn, msg, stickerBuffer, true, pref, command, visualSeconds);
      }
    }

    // Imagen / sticker → esperar audio
    await react(conn, msg, "🎧");
    return startSession(conn, msg, stickerBuffer, isAnimated, pref, command);
  } catch (err) {
    console.error("[ssa] Error:", err);
    await say(conn, msg, "❌ *Hubo un error al crear el sticker con audio.*");
    await react(conn, msg, "❌");
  }
};

handler.command = ["ssa", "ss"];
export default handler;
