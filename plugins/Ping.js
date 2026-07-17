// plugins/ping.js
// Compatible con Baileys ESM/CJS: NO importes '@whiskeysockets/baileys' aquí.
// Usa `wa` inyectado desde tu index.js o `conn.wa`.

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
    // ⚡ Velocidad interna: desde que el mensaje entró al sistema del bot
    // hasta que llegó a este comando (procesamiento real, sin la red).
    const speed = typeof msg.__recvAt === "number"
      ? Math.max(Date.now() - msg.__recvAt, 1)
      : null;

    const start = Date.now();
    const sent = await conn.sendMessage(chatId, { text: "🏓 Pong..." }, { quoted: msg });
    const rtt = Date.now() - start;

    const resultText =
`🏓 *Pong*

⚡ *Velocidad del bot:* ${speed !== null ? `${speed} ms` : "—"}
📡 *Respuesta WhatsApp:* ${rtt} ms`;

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
