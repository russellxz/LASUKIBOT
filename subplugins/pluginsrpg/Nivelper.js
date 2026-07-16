// plugins/nivelper.js
import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender  = msg.key.participant || msg.key.remoteJid;
  const numero  = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "📊", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = fs.existsSync(sukirpgPath)
    ? JSON.parse(fs.readFileSync(sukirpgPath))
    : { usuarios: [] };

  const usuario = (db.usuarios || []).find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(
      chatId,
      { text: "❌ No estás registrado en el RPG. Usa *.rpg nombre apellido edad fechaNacimiento* para empezar." },
      { quoted: msg }
    );
  }

  // Personaje principal
  const personaje = Array.isArray(usuario.personajes) && usuario.personajes.length > 0
    ? usuario.personajes[0]
    : null;

  if (!personaje) {
    return conn.sendMessage(
      chatId,
      { text: "❌ No tienes personajes aún. Usa *.tienda* o *.comprar* para conseguir uno." },
      { quoted: msg }
    );
  }

  // Normalizaciones seguras (para que muestre niveles reales)
  personaje.nivel = Number(personaje.nivel) || 1;
  personaje.xp    = Number(personaje.xp)    || 0;

  // Asegurar 2 habilidades con nivel/xp
  if (!Array.isArray(personaje.habilidades)) personaje.habilidades = [];
  while (personaje.habilidades.length < 2) {
    personaje.habilidades.push({ nombre: `Habilidad ${personaje.habilidades.length + 1}`, nivel: 1, xp: 0 });
  }

  const hab1 = personaje.habilidades[0] || { nombre: "Habilidad 1", nivel: 1, xp: 0 };
  const hab2 = personaje.habilidades[1] || { nombre: "Habilidad 2", nivel: 1, xp: 0 };

  hab1.nivel = Number(hab1.nivel) || 1;
  hab1.xp    = Number(hab1.xp)    || 0;
  hab2.nivel = Number(hab2.nivel) || 1;
  hab2.xp    = Number(hab2.xp)    || 0;

  // (Opcional) Persistir normalizaciones por si faltaban campos
  try { fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2)); } catch {}

  const texto =
    `🎭 *Tu Personaje Principal*\n\n` +
    `👤 *Nombre:* ${personaje.nombre || "—"}\n` +
    `📈 *Nivel:* ${personaje.nivel}  •  ✨ *XP:* ${personaje.xp}\n\n` +
    `🎯 *Habilidades:*\n` +
    `   • ${hab1.nombre} (Nv ${hab1.nivel} • XP ${hab1.xp})\n` +
    `   • ${hab2.nombre} (Nv ${hab2.nivel} • XP ${hab2.xp})\n\n` +
    `📌 *Comandos para subir de nivel tu personaje:*\n` +
    `➤ .luchar  • .volar  • .enemigos • .poder • .podermaximo • .otromundo\n` +
    `➤ .otrouniverso  • .mododios  • .mododiablo  • .superpoder\n` +
    `➤ .batallaanime`;

  const imagen = personaje.imagen || "https://cdn.russellxz.click/a671ee24.jpeg";

  await conn.sendMessage(
    chatId,
    { image: { url: imagen }, caption: texto },
    { quoted: msg }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["nivelper"];
export default handler;
