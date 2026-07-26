// commands/ytmp3.js — YouTube MP3 simple
"use strict";

import { canal } from "../../disenos.js";
import axios from 'axios';

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY || "Russellxz";
const MAX_TIMEOUT = 30000;

async function getYtMp3(url) {
  const endpoint = `${API_BASE}/youtube-mp3`;

  const { data: res, status: http } = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  let data = res;
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); } catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const mp3Url = data.result?.media?.audio;
  if (!mp3Url) throw new Error("No se encontró el MP3");

  return mp3Url;
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `✳️ Usa:\n\( {pref} \){command} <URL YouTube>\nEj: \( {pref} \){command} https://www.youtube.com/watch?v=123` },
      { quoted: msg }
    );
  }

  if (!/youtube\.com|youtu\.be/i.test(text)) {
    return conn.sendMessage(
      chatId,
      {
      contextInfo: canal(), text: `❌ Enlace inválido. Usa URL de YouTube.` },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    const mp3Url = await getYtMp3(text);

    await conn.sendMessage(
      chatId,
      {
        audio: { url: mp3Url },
        mimetype: "audio/mpeg",
      },
      { quoted: msg }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("❌ Error ytmp3:", err?.message || err);
    await conn.sendMessage(chatId, {
      contextInfo: canal(), text: `❌ Error: ${err?.message || "No se pudo descargar el MP3."}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["yt3", "ytmp33"];
handler.help = ["ytmp3 <url>", "yta <url>"];
handler.tags = ["descargas"];
handler.register = true;

export default handler;
