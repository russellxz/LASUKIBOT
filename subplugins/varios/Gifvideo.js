// plugins/gifvideo.js
// No importes Baileys aquí. Pasa { wa } desde tu index.js (o usa conn.wa/global.wa)

function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, command, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  try {
    await conn.sendMessage(chatId, { react: { text: "🎞️", key: msg.key } }).catch(() => {});

    const quotedRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

    const videoMsg = quoted?.videoMessage || null;
    const docMsg   = quoted?.documentMessage || null;
    const isVideoDoc = !!(docMsg?.mimetype && docMsg.mimetype.startsWith("video"));

    if (!videoMsg && !isVideoDoc) {
      return conn.sendMessage(chatId, {
        text: `✳️ *Usa:*\n${pref}${command}\n📌 Responde a un *video* (o documento de video) para convertirlo en estilo GIF largo.`
      }, { quoted: msg });
    }

    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("downloadContentFromMessage no disponible");

    const node   = videoMsg ? videoMsg : docMsg;
    const dlType = videoMsg ? "video" : "document";

    const stream = await WA.downloadContentFromMessage(node, dlType);
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    if (!buffer.length) throw new Error("No se pudo descargar el video");

    await conn.sendMessage(chatId, {
      video: buffer,
      gifPlayback: true,
      // mantener mimetype si viene del doc, ayuda a algunos clientes
      mimetype: node.mimetype || "video/mp4",
      caption: "🎬 *Video convertido al estilo GIF largo (sin audio)*\n\n🍧 _Suki Subbots_"
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  } catch (error) {
    console.error("❌ Error en el comando gifvideo:", error);
    await conn.sendMessage(chatId, { text: "❌ *Ocurrió un error al procesar el video.*" }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
  }
};

handler.command = ["gifvideo"];
handler.help = ["gifvideo"];
handler.tags = ["tools"];
handler.register = true;

export default handler;
