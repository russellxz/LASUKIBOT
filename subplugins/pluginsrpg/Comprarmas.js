import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/[^0-9]/g, "");

  await conn.sendMessage(chatId, { react: { text: "🐾", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  if (!db.usuarios) db.usuarios = [];
  if (!db.mascotas) db.mascotas = [];

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG.\nUsa *.rpg nombre apellido edad fechaNacimiento* para registrarte.",
      quoted: msg
    });
  }

  if (!usuario.mascotas) usuario.mascotas = [];

  if (args.length === 0) {
    return conn.sendMessage(chatId, {
      text: "❌ Debes escribir el número o nombre de la mascota que deseas comprar.",
      quoted: msg
    });
  }

  const arg = args.join(" ").toLowerCase().replace(/[^a-z0-9]/gi, "");
  let mascotaSeleccionada = null;

  if (!isNaN(arg)) {
    mascotaSeleccionada = db.mascotas[parseInt(arg) - 1];
  } else {
    mascotaSeleccionada = db.mascotas.find(m =>
      m.nombre.toLowerCase().replace(/[^a-z0-9]/gi, "") === arg
    );
  }

  if (!mascotaSeleccionada) {
    return conn.sendMessage(chatId, {
      text: "❌ Mascota no encontrada en la tienda.",
      quoted: msg
    });
  }

  const yaTiene = usuario.mascotas.some(m =>
    m.nombre.toLowerCase().replace(/[^a-z0-9]/gi, "") ===
    mascotaSeleccionada.nombre.toLowerCase().replace(/[^a-z0-9]/gi, "")
  );

  if (yaTiene) {
    return conn.sendMessage(chatId, {
      text: `⚠️ Ya tienes la mascota *${mascotaSeleccionada.nombre}*.`,
      quoted: msg
    });
  }

  if (usuario.creditos < mascotaSeleccionada.precio) {
    return conn.sendMessage(chatId, {
      text: `❌ No tienes suficientes créditos. Te faltan *${mascotaSeleccionada.precio - usuario.creditos}* créditos.`,
      quoted: msg
    });
  }

  // Descontar créditos
  usuario.creditos -= mascotaSeleccionada.precio;

  // Crear nueva mascota
  const nuevaMascota = {
    nombre: mascotaSeleccionada.nombre,
    imagen: mascotaSeleccionada.imagen,
    precio: mascotaSeleccionada.precio,
    nivel: 1,
    habilidades: mascotaSeleccionada.habilidades.map(h => ({ ...h }))
  };

  // Insertar como primera (principal)
  usuario.mascotas.unshift(nuevaMascota);

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // Avatar del usuario
  let avatarURL = "https://cdn.russellxz.click/f20c1249.jpeg";
  try {
    const pp = await conn.profilePictureUrl(sender, "image");
    if (pp) avatarURL = pp;
  } catch {}

  const fecha = new Date().toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  // Canvas factura
  const canvas = createCanvas(800, 500);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const avatar = await loadImage(avatarURL);
  ctx.save();
  ctx.beginPath();
  ctx.arc(90, 90, 60, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, 30, 30, 120, 120);
  ctx.restore();

  const imgMascota = await loadImage(mascotaSeleccionada.imagen);
  ctx.drawImage(imgMascota, 50, 160, 200, 250);

  ctx.fillStyle = "#000";
  ctx.font = "bold 30px Sans-serif";
  ctx.fillText("❦FACTURA DE COMPRA❦", 260, 60);

  ctx.font = "20px Sans-serif";
  ctx.fillText(`➤ Usuario: ${usuario.nombre} ${usuario.apellido}`, 300, 120);
  ctx.fillText(`➤ Edad: ${usuario.edad}`, 300, 150);
  ctx.fillText(`➤ Fecha: ${fecha}`, 300, 180);
  ctx.fillText(`➤ Mascota: ${mascotaSeleccionada.nombre}`, 300, 210);
  ctx.fillText(`➤ Habilidades:`, 300, 240);
  ctx.fillText(`• ${mascotaSeleccionada.habilidades[0].nombre} (Nivel 1)`, 320, 270);
  ctx.fillText(`• ${mascotaSeleccionada.habilidades[1].nombre} (Nivel 1)`, 320, 300);
  ctx.fillText(`➤ Precio: ${mascotaSeleccionada.precio} créditos`, 300, 340);
  ctx.fillText(`➤ Saldo restante: ${usuario.creditos} créditos`, 300, 370);

  ctx.fillStyle = "#28a745";
  ctx.font = "bold 38px Sans-serif";
  ctx.fillText("✔ COMPRA APROBADA", 310, 460);

  const buffer = canvas.toBuffer("image/png");

  await conn.sendMessage(chatId, {
    image: buffer,
    caption: `✅ *Mascota comprada exitosamente*\n\nUsa *.vermascotas* para ver todas las que has comprado.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });
};

handler.command = ["comprarmas"];
export default handler;
