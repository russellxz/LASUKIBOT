import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🧬", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG. Usa *.rpg nombre apellido edad fechaNacimiento* para registrarte.",
      quoted: msg
    });
  }

  if (!usuario.personajes || usuario.personajes.length === 0) {
    return conn.sendMessage(chatId, {
      text: "❌ No tienes personajes comprados. Compra uno con *.comprarper*.",
      quoted: msg
    });
  }

  // Mostrar lista si no pasa argumento
  if (args.length === 0) {
    let lista = `🎭 *Tus personajes disponibles:*\n\n`;
    usuario.personajes.forEach((p, i) => {
      lista += `*${i + 1}.* ${p.nombre} (Nivel ${p.nivel})\n`;
    });
    lista += `\n✳️ Usa:\n.per número o nombre del personaje\n📌 Ej:\n• .per 2\n• .per goku`;
    return conn.sendMessage(chatId, {
      text: lista,
      quoted: msg
    });
  }

  const arg = args.join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");

  let index = -1;
  if (!isNaN(arg)) {
    const idx = parseInt(arg) - 1;
    if (usuario.personajes[idx]) index = idx;
  } else {
    index = usuario.personajes.findIndex(p =>
      p.nombre.toLowerCase().replace(/[^a-z0-9]/g, "") === arg
    );
  }

  if (index === -1) {
    return conn.sendMessage(chatId, {
      text: "❌ Personaje no encontrado entre los que has comprado.",
      quoted: msg
    });
  }

  // Reordenar personaje al inicio (como principal)
  const personajeSeleccionado = usuario.personajes.splice(index, 1)[0];
  usuario.personajes.unshift(personajeSeleccionado);

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  await conn.sendMessage(chatId, {
    text: `✅ *${personajeSeleccionado.nombre}* ahora es tu personaje principal.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: "🧬", key: msg.key }
  });
};

handler.command = ["per"];
export default handler;
