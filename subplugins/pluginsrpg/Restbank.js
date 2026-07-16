import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/[^0-9]/g, "");

  // 🔒 Permisos
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  // 📌 Confirmación obligatoria
  if (!args[0] || args[0].toLowerCase() !== "siquiero") {
    return conn.sendMessage(chatId, {
      text: `⚠️ Este comando eliminará *todo* el sistema del banco (capital, tiempo y préstamos).\n\n` +
            `Para confirmar, usa:\n*.restbank siquiero*`,
      quoted: msg
    });
  }

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};

  // 🏦 Restablecer el banco
  db.banco = {
    montoTotal: 0,
    tiempoLimite: 0,
    prestamos: []
  };

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  await conn.sendMessage(chatId, {
    text: "🏦 El banco ha sido restablecido completamente.\n📉 Capital: *0 créditos*\n🗑 Préstamos: *0*",
    quoted: msg
  });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["restbank"];
export default handler;
