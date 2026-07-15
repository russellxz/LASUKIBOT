
"use strict";

import axios from 'axios';

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

const LIMIT = 10;

// ---- helpers ----
function looksLikeUrl(s = "") {
  return /^https?:\/\//i.test(String(s || ""));
}

function pickBestImage(it) {
  return (
    it?.image_medium_url ||
    it?.image_large_url ||
    it?.image_small_url ||
    it?.url ||
    it?.image ||
    ""
  );
}

// descarga imagen a buffer (para mandarla por whatsapp)
async function downloadImageBuffer(url) {
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "image/*,*/*",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(r.data);
}

// ✅ Llamada correcta a tu API NUEVA (plugin: /pinterestimg)
async function callPinterestImages(q) {
  const endpoint = `${API_BASE}/pinterestimg`; // ✅ correcto
  const r = await axios.post(
    endpoint,
    { q, limit: LIMIT }, // limit lo mandamos por si luego lo usas; tu API puede ignorarlo
    {
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Accept: "application/json, */*",
      },
      timeout: 60000,
      validateStatus: () => true,
    }
  );

  // Si vino string (HTML/texto), intentamos parsear JSON
  let data = r.data;
  if (typeof data === "string") {
    const t = data.trim();
    try {
      data = JSON.parse(t);
    } catch {
      // HTML / texto
      throw new Error(`Respuesta no JSON del servidor (HTTP ${r.status})`);
    }
  }

  if (!data || typeof data !== "object") {
    throw new Error(`API inválida (HTTP ${r.status})`);
  }

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) {
    throw new Error(data.message || data.error || `Error en API (HTTP ${r.status})`);
  }

  // tu API devuelve { status:true, result:{ ... } }
  const payload = data.result || data.data || data;
  return payload;
}

// ---- command ----
const handler = async (msg, { conn, text }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  const input = String(text || "").trim();
  if (!input) {
    return conn.sendMessage(
      chatId,
      { text: `🖼️ Usa:\n${pref}pinterestimg <búsqueda>\nEj: ${pref}pinterestimg gatos anime` },
      { quoted: msg }
    );
  }

  // ✅ Solo búsqueda por texto (como pediste)
  if (looksLikeUrl(input)) {
    return conn.sendMessage(
      chatId,
      { text: `⚠️ Este comando ahora es SOLO búsqueda por texto.\nEj: ${pref}pinterestimg gatos anime` },
      { quoted: msg }
    );
  }

  // reaccion inicio
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    const result = await callPinterestImages(input);

    // Tu API: result.results (array)
    const raw = Array.isArray(result?.results) ? result.results : Array.isArray(result) ? result : [];
    const images = raw.slice(0, LIMIT);

    if (!images.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No encontré imágenes." }, { quoted: msg });
    }

    await conn.sendMessage(
      chatId,
      {
        text:
          `📌 Pinterest resultados: *${images.length}*\n` +
          `🔎 Búsqueda: *${input}*\n` +
          `📤 Enviando las primeras ${images.length} imágenes...`,
      },
      { quoted: msg }
    );

    for (let i = 0; i < images.length; i++) {
      const it = images[i];
      const url = pickBestImage(it);
      if (!url) continue;

      await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

      try {
        const buf = await downloadImageBuffer(url);
        await conn.sendMessage(
          chatId,
          { image: buf, caption: `(${i + 1}/${images.length}) ${it.title || "Pinterest"}` },
          { quoted: msg }
        );
      } catch (e) {
        // fallback: manda URL si falla buffer
        await conn.sendMessage(
          chatId,
          { text: `(${i + 1}/${images.length}) ${it.title || "Pinterest"}\n${url}` },
          { quoted: msg }
        );
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
  }
};

handler.command = ["pinterestimg", "pinterest", "pimg"];

export default handler;
