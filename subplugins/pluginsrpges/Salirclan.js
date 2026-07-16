// plugins/salirclan.js
// Comando: .salirclan / .salir
// Sale del clan actual. Si el usuario es líder, NO le permite salir.
// Cobra 20,000 créditos y los deposita en la bodega del clan.
// Reacciona al inicio y al final.

import fs from 'fs';
import path from 'path';

function loadDB(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}
function saveDB(p, o) {
  fs.writeFileSync(p, JSON.stringify(o, null, 2));
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const COSTO_SALIR = 20000;

  // reacción inicial
  await conn.sendMessage(chatId, { react: { text: "✨", key: msg.key } });

  const file = path.join(process.cwd(), "sukirpg.json");
  const db = loadDB(file);
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.clanes = Array.isArray(db.clanes) ? db.clanes : [];

  const user = db.usuarios.find(u => String(u.numero) === String(numero));
  if (!user) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "❌ No estás registrado en el RPG.", quoted: msg });
  }

  const clan = db.clanes.find(c =>
    Array.isArray(c.miembros) && c.miembros.some(m => String(m.numero) === String(numero))
  );
  if (!clan) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "📭 No perteneces a ningún clan.", quoted: msg });
  }

  // Verificar si es líder
  const esLider =
    clan.lider && clan.lider.numero && clan.lider.numero !== "BOT" && String(clan.lider.numero) === String(numero);
  if (esLider) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Eres el líder de este clan, no puedes salir.\n📌 Usa *.pasarlider @usuario* para transferir el liderazgo antes de salir.",
      quoted: msg
    });
  }

  // Verificar créditos suficientes
  if (Number(user.creditos || 0) < COSTO_SALIR) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `💰 Necesitas *${COSTO_SALIR.toLocaleString("es-ES")}* créditos para salir del clan.`,
      quoted: msg
    });
  }

  // Cobrar y depositar en la bodega del clan
  user.creditos -= COSTO_SALIR;
  clan.bodegaCreditos = Number(clan.bodegaCreditos || 0) + COSTO_SALIR;

  // Remover usuario de miembros
  clan.miembros = clan.miembros.filter(m => String(m.numero) !== String(numero));

  saveDB(file, db);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  return conn.sendMessage(chatId, {
    text: `✅ Saliste del clan *${clan.nombre}*\n💸 Pagaste *${COSTO_SALIR.toLocaleString("es-ES")}* créditos que fueron depositados en la bodega del clan.`,
    quoted: msg
  });
};

handler.command = ["salirclan", "salir"];
export default handler;
