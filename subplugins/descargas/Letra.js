// comandos/letra.js — Lyrics Search (solo texto)
// ✅ Responde con: Título / Artista / Álbum / Letra
// ✅ Branding: Suki Subbots + SkyUltraPlus API
// ✅ No descarga archivos

"use strict";

import { getMarca, canal } from "../../disenos.js";
import axios from 'axios';

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000; // 60s

async function getLyricsFromSky(text) {
  const { data: res, status: http } = await axios.post(
    `${API_BASE}/tools/lyrics`,
    { text },
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

  if (http !== 200) {
    throw new Error(`HTTP ${http}${res?.message ? ` - ${res.message}` : ""}`);
  }

  if (!res || res.status !== true || !res.result?.lyrics) {
    throw new Error(res?.message || "La API no devolvió letra.");
  }

  const r = res.result;
  return {
    artist: r.artist || "Unknown",
    title: r.title || "Unknown",
    album: r.album || "",
    lyrics: r.lyrics || "",
  };
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref   = ((typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes) && (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)[0]) || ".";
  const query  = (args || []).join(" ").trim();

  if (!query) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(),
        text:
`✳️ 𝙐𝙨𝙖:
${pref}${command || "letra"} <canción y artista>
Ej: ${pref}${command || "letra"} yemil difícil amarte`,
      },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    const d = await getLyricsFromSky(query);

    const title = String(d.title || "Unknown");
    const artist = String(d.artist || "Unknown");
    const album = String(d.album || "").trim();
    const lyrics = String(d.lyrics || "").trim();

    const header =
`🎶 *LETRA ENCONTRADA*
━━━━━━━━━━━━━━━━
📌 *Título:* ${title}
🎤 *Artista:* ${artist}${album ? `\n💿 *Álbum:* ${album}` : ""}

🚀 *Powered by:* SkyUltraPlus API
🔗 ${API_BASE}/tools/lyrics
🤖 *Bot:* ${getMarca(conn)}

`;

    // WhatsApp suele cortar mensajes muy largos: dividimos en partes seguras
    const MAX_CHUNK = 3500;

    const fullText = header + lyrics;
    if (fullText.length <= MAX_CHUNK) {
      await conn.sendMessage(chatId, {
      contextInfo: canal(), text: fullText }, { quoted: msg });
    } else {
      // 1) Header primero
      await conn.sendMessage(chatId, {
      contextInfo: canal(), text: header }, { quoted: msg });

      // 2) Lyrics en chunks
      for (let i = 0; i < lyrics.length; i += MAX_CHUNK) {
        const part = lyrics.slice(i, i + MAX_CHUNK);
        await conn.sendMessage(chatId, {
      contextInfo: canal(), text: part }, { quoted: msg });
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("❌ Error en letra:", err?.message || err);
    await conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ *Error:* ${err?.message || "No pude obtener la letra."}` },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["letra", "lyrics"];
handler.help = ["letra <canción y artista>", "lyrics <song and artist>"];
handler.tags = ["tools"];
handler.register = true;

export default handler;
