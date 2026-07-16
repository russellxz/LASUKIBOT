import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, { react: { text: "🛒", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};

  db.personajes_venta = db.personajes_venta || [];

  if (db.personajes_venta.length === 0) {
    return conn.sendMessage(chatId, {
      image: { url: "https://cdn.russellxz.click/7451040a.jpeg" },
      caption: "❌ Actualmente no hay personajes a la venta en el mercado.",
      quoted: msg
    });
  }

  let texto = `🏷️ *PERSONAJES EN VENTA*\n\n`;

  db.personajes_venta.forEach((p, i) => {
    texto += `*${i + 1}.* ${p.nombre}\n`;
    texto += `🎴 *Nivel:* ${p.nivel}\n`;
    texto += `🌀 *Habilidades:*\n`;
    texto += `  • ${p.habilidades[0].nombre} (Nivel ${p.habilidades[0].nivel})\n`;
    texto += `  • ${p.habilidades[1].nombre} (Nivel ${p.habilidades[1].nivel})\n`;
    texto += `💵 *Precio original:* ${p.precio_original} créditos\n`;
    texto += `🏷️ *Precio de venta:* ${p.precio_venta} créditos\n\n`;
    texto += `🧑 *Vendedor:* ${p.vendedor.nombre} ${p.vendedor.apellido}\n`;
    texto += `🎂 *Edad:* ${p.vendedor.edad} años\n`;
    texto += `📈 *Nivel del vendedor:* ${p.vendedor.nivel}\n`;
    texto += `────────────────\n\n`;
  });

  await conn.sendMessage(chatId, {
    image: { url: "https://cdn.russellxz.click/7451040a.jpeg" },
    caption: texto,
    quoted: msg
  });
};

handler.command = ["alaventa"];
export default handler;
