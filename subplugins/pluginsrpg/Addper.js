import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/[^0-9]/g, "");

  // 🛒 Reacción inicial
  await conn.sendMessage(chatId, {
    react: { text: "🛒", key: msg.key }
  });

  // Verificar si es owner o el bot
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  if (args.length < 5) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso correcto:*\n.addper ⚔️Nombre ☠️Habilidad1 🐉Habilidad2 ImagenURL Precio\n\n📌 Ejemplo:\n.addper ⚔️Sung_Jin-Woo ☠️Sombra_Absoluta 🐉Dominio_Monarca https://cdn.russellxz.click/890e3c01.jpeg 12000`
    }, { quoted: msg });
  }

  const [nombre, hab1, hab2, imagen, precioStr] = args;
  const precio = parseInt(precioStr);

  if (isNaN(precio)) {
    return conn.sendMessage(chatId, {
      text: "❌ El precio debe ser un número válido."
    }, { quoted: msg });
  }

  const personaje = {
    nombre,
    imagen,
    precio,
    nivel: 1,
    habilidades: [
      { nombre: hab1, nivel: 1 },
      { nombre: hab2, nivel: 1 }
    ]
  };

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let data = {};
  if (fs.existsSync(sukirpgPath)) {
    data = JSON.parse(fs.readFileSync(sukirpgPath));
  }

  if (!data.personajes) data.personajes = [];

  // 🛑 Verificar duplicado
  const yaExiste = data.personajes.some(p =>
    p.nombre.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ===
    nombre.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  );

  if (yaExiste) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: `⚠️ El personaje *${nombre.replace(/_/g, " ")}* ya está en la tienda.`
    }, { quoted: msg });
  }

  data.personajes.push(personaje);
  fs.writeFileSync(sukirpgPath, JSON.stringify(data, null, 2));

  const caption = `✅ *Personaje agregado exitosamente a la tienda*\n\n` +
                  `⚔️ *Nombre:* ${nombre.replace(/_/g, " ")}\n` +
                  `💳 *Precio:* ${precio} créditos\n` +
                  `📈 *Nivel:* 1\n` +
                  `☠️ *Habilidad 1:* ${hab1.replace(/_/g, " ")} (Nivel 1)\n` +
                  `🐉 *Habilidad 2:* ${hab2.replace(/_/g, " ")} (Nivel 1)`;

  await conn.sendMessage(chatId, {
    image: { url: imagen },
    caption
  }, { quoted: msg });

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });
};

handler.command = ["addper"];
export default handler;
