import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });

  const input = args.join(" ");
  if (!input) {
    return conn.sendMessage(chatId, {
      text: "✳️ *Uso correcto:*\n.quitarventa <nombre o número>\n📌 Ej: .quitarventa 2 o .quitarventa goku",
      quoted: msg
    });
  }

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];
  db.personajes_venta = db.personajes_venta || [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG.",
      quoted: msg
    });
  }

  let personaje = null;

  if (/^\d+$/.test(input)) {
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < db.personajes_venta.length) {
      const temp = db.personajes_venta[idx];
      if (temp.vendedor.numero === numero) {
        personaje = temp;
      }
    }
  } else {
    const normalizado = input.toLowerCase().replace(/[^a-z0-9]/g, "");
    personaje = db.personajes_venta.find(p =>
      p.vendedor.numero === numero &&
      p.nombre.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizado
    );
  }

  if (!personaje) {
    return conn.sendMessage(chatId, {
      text: "❌ No se encontró ningún personaje tuyo en venta con ese nombre o número.",
      quoted: msg
    });
  }

  // Volver a poner el personaje en el inventario del usuario
  usuario.personajes = usuario.personajes || [];
  usuario.personajes.push({
    nombre: personaje.nombre,
    imagen: personaje.imagen,
    precio: personaje.precio_original,
    nivel: personaje.nivel,
    habilidades: personaje.habilidades.map(h => ({ ...h }))
  });

  // Eliminar de la venta
  db.personajes_venta = db.personajes_venta.filter(p =>
    !(p.nombre === personaje.nombre && p.vendedor.numero === numero)
  );

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  await conn.sendMessage(chatId, {
    image: { url: personaje.imagen },
    caption: `✅ *${personaje.nombre}* ha sido retirado exitosamente del mercado y volvió a tu inventario.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: "🔙", key: msg.key }
  });
};

handler.command = ["quitarventa"];
export default handler;
