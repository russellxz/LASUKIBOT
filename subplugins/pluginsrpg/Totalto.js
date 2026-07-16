// plugins/totalto.js
import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "📊", key: msg.key } });

  // Cargar DB
  const dbPath = path.join(process.cwd(), "sukirpg.json");
  let db = {};
  try {
    db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf-8")) : {};
  } catch (e) {
    return conn.sendMessage(chatId, {
      text: "❌ Error leyendo la base de datos (sukirpg.json).",
    }, { quoted: msg });
  }

  // Normalizaciones
  const usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  const tiendaPersonajes = Array.isArray(db.personajes) ? db.personajes : [];
  const tiendaMascotas   = Array.isArray(db.mascotas)   ? db.mascotas   : [];

  // Totales en carteras de usuarios
  let totalPersUsuarios = 0;
  let totalMascUsuarios = 0;

  for (const u of usuarios) {
    const pers = Array.isArray(u.personajes) ? u.personajes.length : 0;
    const masc = Array.isArray(u.mascotas)   ? u.mascotas.length   : 0;
    totalPersUsuarios += pers;
    totalMascUsuarios += masc;
  }

  const texto =
`📊 *TOTALES RPG • La Suki Bot*

👥 *Usuarios registrados:* ${usuarios.length}

🎭 *Personajes*
• En tienda: *${tiendaPersonajes.length}*
• En carteras de usuarios: *${totalPersUsuarios}*

🐾 *Mascotas*
• En tienda: *${tiendaMascotas.length}*
• En carteras de usuarios: *${totalMascUsuarios}*`;

  await conn.sendMessage(chatId, { text: texto }, { quoted: msg });
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["totalto"];
export default handler;
