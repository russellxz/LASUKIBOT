import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, {
    react: { text: "🛒", key: msg.key }
  });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");

  let db = {};
  if (fs.existsSync(sukirpgPath)) {
    db = JSON.parse(fs.readFileSync(sukirpgPath));
  }

  const personajes = db.personajes || [];

  if (!personajes.length) {
    return conn.sendMessage(chatId, {
      text: "🚫 No hay personajes disponibles en la tienda por ahora.",
      quoted: msg
    });
  }

  // Crear listado de personajes con total
  let texto = `🛒 *TIENDA DE PERSONAJES* 🛒\n`;
  texto += `📊 *Total en tienda:* ${personajes.length}\n\n`;
  texto += `📌 Usa: *.comprar número* o *.comprar nombre*\nEj: *.comprar 2* o *.comprar ⚔️Sung_Jin-Woo*\n\n`;
  
  personajes.forEach((p, index) => {
    texto += `🔢 *#${index + 1}*\n`;
    texto += `⚔️ *Nombre:* ${p.nombre.replace(/_/g, " ")}\n`;
    texto += `📈 *Nivel:* ${p.nivel || 1}\n`;
    texto += `💳 *Precio:* ${p.precio} créditos\n`;
    texto += `🌀 *Habilidades:*\n`;
    p.habilidades.forEach((h, i) => {
      texto += `   ${i + 1}. ${h.nombre.replace(/_/g, " ")} (Nivel ${h.nivel || 1})\n`;
    });
    texto += `────────────────────\n`;
  });

  await conn.sendMessage(chatId, {
    image: { url: "https://cdn.russellxz.click/2695e1bd.jpeg" },
    caption: texto
  }, { quoted: msg });

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });
};

handler.command = ["tiendaper"];
export default handler;
