// yt2.js — YouTube -> VIDEO
import { canal } from "../../disenos.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

function isYouTube(u){
  return /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);
}

const handler = async (msg, { conn, args, command }) => {
  const jid  = msg.key.remoteJid;
  const url  = (args.join(" ") || "").trim();
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  if (!url) {
    return conn.sendMessage(jid, {
      contextInfo: canal(),
      text: `✳️ *Usa:*\n${pref}${command} <url>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(jid, {
      contextInfo: canal(), text: "❌ *URL de YouTube inválida.*" }, { quoted: msg });
  }

  try {
    await conn.sendMessage(jid, { react: { text: "⏱️", key: msg.key } });

    // Llamada a TU API (video)
    const r = await axios.get(`${API_BASE}/api/download/yt.php`, {
      params: { url, format: "video" },
      headers: { Authorization: `Bearer ${API_KEY}`, "X-API-Key": API_KEY },
      timeout: 30000,
      validateStatus: s => s < 500
    });

    if (r.status !== 200 || r.data?.status !== "true") {
      throw new Error(`API ${r.status}: ${JSON.stringify(r.data)}`);
    }

    const { title, video, audio } = r.data.data || {};
    const mediaUrl = video || audio; // fallback si upstream no da mp4 directo
    if (!mediaUrl) throw new Error("El API no devolvió video.");

    // Descargar a tmp
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const filePath = path.join(tmpDir, `yt-v-${Date.now()}.mp4`);

    const resp = await axios.get(mediaUrl, { responseType: "stream" });
    await new Promise((res, rej) => {
      const w = fs.createWriteStream(filePath);
      resp.data.pipe(w); w.on("finish", res); w.on("error", rej);
    });

    const sizeMB = fs.statSync(filePath).size / (1024 * 1024);
    if (sizeMB > 1024) {
      fs.unlinkSync(filePath);
      await conn.sendMessage(jid, {
      contextInfo: canal(), text: `❌ Archivo de ${sizeMB.toFixed(2)}MB excede 99MB.` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      return;
    }

    const caption = `📺 *YouTube DL (video)*\n• *Título:* ${title || "Sin título"}\n• *API:* SkyUltraPlus`;
    await conn.sendMessage(jid, {
      video: fs.readFileSync(filePath),
      mimetype: "video/mp4",
      caption
    }, { quoted: msg });

    fs.unlinkSync(filePath);
    await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("yt2 error:", err?.message || err);
    try {
      await conn.sendMessage(jid, {
      contextInfo: canal(), text: `❌ ${err?.message || "Error procesando el enlace."}` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch {}
  }
};

handler.command = ["yt2"];
export default handler;
