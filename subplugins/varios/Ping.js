// plugins/ping.js — Ping optimizado (sin reacciones: cada una era un viaje
// de red extra que retrasaba la respuesta).
// Compatible con Baileys ESM/CJS: NO importes '@whiskeysockets/baileys' aquí.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// obtiene el módulo de Baileys para acceder a `proto`
function ensureWA(wa, conn) {
  if (wa && wa.proto) return wa;
  if (conn && conn.wa && conn.wa.proto) return conn.wa;
  if (global.wa && global.wa.proto) return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  try {
    const start = Date.now();
    const sent = await conn.sendMessage(chatId, { text: "🏓 Pong..." }, { quoted: msg });
    const ping = Date.now() - start;
    const resultText = `🏓 Pong\n\n✅ Ping: ${ping} ms`;

    const WA = ensureWA(wa, conn);
    const proto = WA?.proto;

    if (isGroup && proto) {
      await sleep(100);
      try {
        await conn.relayMessage(
          chatId,
          {
            protocolMessage: {
              key: sent.key,
              type: 14, // edit
              editedMessage: proto.Message.fromObject({
                conversation: resultText
              })
            }
          },
          { messageId: sent.key.id }
        );
      } catch {
        // si falla la edición, enviamos un nuevo mensaje
        await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
      }
    } else {
      // en PV o si no hay proto, solo enviamos el resultado
      await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
    }
  } catch (e) {
    console.error("Error en ping:", e);
    await conn.sendMessage(chatId, { text: "❌ Error calculando el ping." }, { quoted: msg }).catch(() => {});
  }
};

handler.command = ["ping"];
export default handler;
