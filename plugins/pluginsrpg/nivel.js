import fs from 'fs';
import path from 'path';
import { mediaBuffer } from '../../libs/media.js';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, {
    react: { text: "📈", key: msg.key }
  });

  // Determinar número del usuario (autor o citado)
  const isQuoted = msg.message?.extendedTextMessage?.contextInfo;
  let numero = msg.key.participant || msg.key.remoteJid;
  numero = numero.replace(/[^0-9]/g, "");

  let citado = isQuoted?.participant || null;
  if (citado) citado = citado.replace(/[^0-9]/g, "");
  const target = citado || numero;

  // Cargar base de datos
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  if (!db.usuarios) db.usuarios = [];

  const user = db.usuarios.find(u => u.numero === target);
  if (!user) {
    return conn.sendMessage(chatId, {
      text: "❌ El usuario aún no está registrado en el RPG. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte.",
      quoted: msg
    });
  }

  // Obtener avatar del usuario o usar uno por defecto
  let avatarURL = null;
  try {
    const pp = await conn.profilePictureUrl(`${target}@s.whatsapp.net`, "image");
    if (pp) avatarURL = pp;
  } catch {}

  // Construir el texto del perfil RPG
  let texto = `📊 *Estadísticas RPG de ${user.nombre} ${user.apellido}*\n\n` +
              `🎂 *Edad:* ${user.edad} años\n` +
              `📅 *Nacimiento:* ${user.fechaNacimiento}\n` +
              `📈 *Nivel:* ${user.nivel}\n\n` +
              `🌀 *Habilidades:*\n` +
              user.habilidades.map((h, i) => ` ${i+1}. ${h.nombre} (Nivel ${h.nivel})`).join("\n") + `\n\n` +
              `⚔️ *Personajes:* ${user.personajes?.length || 0}\n` +
              `🐾 *Mascotas:* ${user.mascotas?.length || 0}\n` +
              `💳 *Créditos:* ${user.creditos}\n` +
              `💼 *Guardado:* ${user.guardado}\n\n` +
              `🎮 *Comandos para subir de nivel:*\n` +
              `• .minar\n` +
              `• .work\n` +
              `• .picar\n` +
              `• .correr\n` +
              `• .talar\n` +
              `• .cocinar\n` +
              `• .estudiar\n` +
              `• .claim\n` +
              `• .batallauser\n` +
              `• .cofre`;

  // Enviar imagen con el texto
  await conn.sendMessage(chatId, {
    image: avatarURL ? { url: avatarURL } : mediaBuffer("nivel"),
    caption: texto,
    quoted: msg
  });
};

handler.command = ["nivel"];
export default handler;
