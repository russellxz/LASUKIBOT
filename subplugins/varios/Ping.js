// subplugins/varios/Ping.js — Ping optimizado del subbot
// Sin reacciones previas (cada reacción es un viaje completo a WhatsApp que
// retrasaba la respuesta). Muestra dos números:
//  ⚡ Velocidad del bot: tiempo REAL de procesamiento interno (ms)
//  📡 Respuesta WhatsApp: viaje de red del mensaje hasta el servidor

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    // ⚡ Velocidad interna: desde que el mensaje entró al sistema del subbot
    // hasta que llegó a este comando (pipeline completo).
    const speed = typeof msg.__subRecvAt === "number"
      ? Math.max(Date.now() - msg.__subRecvAt, 1)
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
        await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
      }
    } else {
      await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
    }
  } catch (e) {
    console.error("Error en ping:", e);
    await conn.sendMessage(chatId, { text: "❌ Error calculando el ping." }, { quoted: msg }).catch(() => {});
  }
};

handler.command = ["ping"];
export default handler;
