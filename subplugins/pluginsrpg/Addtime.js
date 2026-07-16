// plugins/addtime.js
import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/[^0-9]/g, "");

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  // 🔒 Solo Owner / Bot
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  // 📌 Validación
  if (!args[0]) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso correcto:*\n.addtime <tiempo>\n\n📌 Ejemplos:\n• .addtime 5m (5 minutos)\n• .addtime 2h (2 horas)\n• .addtime 24h (24 horas)`,
      quoted: msg
    });
  }

  const tiempoInput = String(args[0] || "").toLowerCase().trim();
  const match = tiempoInput.match(/^(\d+)([mh])$/i);
  if (!match) {
    return conn.sendMessage(chatId, {
      text: "❌ El tiempo debe especificarse en minutos (m) o horas (h).\nEj: 5m, 2h, 24h",
      quoted: msg
    });
  }

  const valor = parseInt(match[1]);
  const unidad = match[2].toLowerCase();
  const tiempoMS = unidad === "m" ? valor * 60 * 1000 : valor * 60 * 60 * 1000;

  // 📂 Editar solo el tiempo del banco
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath)
    ? JSON.parse(fs.readFileSync(sukirpgPath))
    : {};

  if (!db.banco) {
    return conn.sendMessage(chatId, {
      text: "🏦 No hay un banco configurado. Usa primero *.addbank*.",
      quoted: msg
    });
  }

  db.banco.plazo = {
    valor,
    unidad,
    ms: tiempoMS,
    texto: tiempoInput
  };

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  await conn.sendMessage(chatId, {
    text:
`🏦 *Tiempo del banco actualizado*
⏳ *Nuevo plazo por préstamo:* ${valor}${unidad} (${tiempoMS.toLocaleString()} ms)
📌 Afectará a los nuevos préstamos y a los plazos que reinicie el sistema.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["addtime"];
export default handler;
