// plugins/tts.js — Text To Speech con Google TTS
// Convierte el MP3 de Google TTS a OGG/Opus para que WhatsApp lo reproduzca como nota de voz.
// Uso: .tts <texto>   o   .tts (respondiendo a un mensaje con texto)

"use strict";

import fs from 'fs';
import path from 'path';
import Crypto from 'crypto';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import SpeakEngine from 'google-tts-api';

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  const command = "tts";

  const rid = Crypto.randomBytes(6).toString("hex");
  const mp3Path = path.join(TMP_DIR, `tts_${rid}.mp3`);
  const oggPath = path.join(TMP_DIR, `tts_${rid}.ogg`);

  try {
    await conn.sendMessage(chatId, {
      react: { text: "🗣️", key: msg.key }
    });

    let textToSay = args.join(" ").trim();

    if (!textToSay && quoted) {
      textToSay =
        quoted.conversation ||
        quoted?.extendedTextMessage?.text ||
        quoted?.imageMessage?.caption ||
        quoted?.videoMessage?.caption || "";
    }

    if (!textToSay) {
      return conn.sendMessage(chatId, {
        text: `⚠️ *Proporciona un texto o responde a un mensaje para convertirlo a voz.*\n✳️ *Ejemplo:* \`${pref}${command} hola mundo\``
      }, { quoted: msg });
    }

    // Google TTS tiene límite de ~200 caracteres por chunk
    if (textToSay.length > 200) {
      textToSay = textToSay.slice(0, 200);
    }

    await conn.sendPresenceUpdate("recording", chatId);

    // 1) Obtener URL del MP3 de Google TTS
    const audioUrl = SpeakEngine.getAudioUrl(textToSay, {
      lang: "es",
      slow: false,
      host: "https://translate.google.com",
    });

    // 2) Descargar el MP3 con headers que Google exige (si no, a veces devuelve 404/403)
    const audioRes = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Referer": "https://translate.google.com/"
      }
    });

    const mp3Buffer = Buffer.from(audioRes.data);
    fs.writeFileSync(mp3Path, mp3Buffer);

    // 3) Convertir MP3 → OGG/Opus (el formato que WhatsApp exige para PTT)
    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec("libopus")
        .audioChannels(1)
        .audioFrequency(48000)
        .audioBitrate("64k")
        .outputOptions([
          "-avoid_negative_ts", "make_zero",
          "-application", "voip"
        ])
        .format("ogg")
        .on("end", resolve)
        .on("error", reject)
        .save(oggPath);
    });

    // 4) Leer el OGG y enviar como nota de voz
    const oggBuffer = fs.readFileSync(oggPath);

    await conn.sendMessage(chatId, {
      audio: oggBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    }, { quoted: msg });

    try { await conn.sendPresenceUpdate("paused", chatId); } catch {}

    // 5) Limpiar temporales
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (error) {
    console.error("❌ Error en el comando tts:", error);
    try { await conn.sendPresenceUpdate("paused", chatId); } catch {}
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}

    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(chatId, {
      text: `❌ *Ocurrió un error al convertir texto a voz.*\n\`${error.message || "Desconocido"}\``
    }, { quoted: msg });
  }
};

handler.command = ["tts"];
handler.help = ["tts <texto>"];
handler.tags = ["audio"];
export default handler;
