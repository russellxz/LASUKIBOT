import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🐾", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  if (!db.usuarios) db.usuarios = [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario || !usuario.mascotas || usuario.mascotas.length === 0) {
    return conn.sendMessage(chatId, {
      text: "❌ No tienes mascotas registradas.\nUsa *.rpg* o *.comprarmas* para obtener una.",
      quoted: msg
    });
  }

  const m = usuario.mascotas[0]; // mascota principal

  const texto = `🐶 *Estadísticas de tu Mascota Principal*\n\n` +
                `📛 *Nombre:* ${m.nombre}\n` +
                `🎯 *Nivel:* ${m.nivel}\n\n` +
                `✨ *Habilidades:*\n` +
                `• ${m.habilidades[0].nombre} (Nivel ${m.habilidades[0].nivel})\n` +
                `• ${m.habilidades[1].nombre} (Nivel ${m.habilidades[1].nivel})\n\n` +
                `🎮 *Comandos para subir de nivel tu mascota:*\n` +
                `• .daragua\n` +
                `• .darcomida\n` +
                `• .darcariño\n` +
                `• .entrenar\n` +
                `• .cazar\n` +
                `• .presumir\n` +
                `• .pasear\n` +
                `• .supermascota\n` +
                `• .batallamascota\n` +
                `• .mascota (para cambiar de mascota principal)`;

  await conn.sendMessage(chatId, {
    image: { url: m.imagen || "https://cdn.russellxz.click/25e8051c.jpeg" },
    caption: texto,
    quoted: msg
  });
};

handler.command = ["nivelmascota", "nivelmas"];
export default handler;
