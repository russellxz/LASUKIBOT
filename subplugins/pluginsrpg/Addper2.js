// plugins/addper2.js
import fs from 'fs';
import path from 'path';

const PAUSA_MS = 3000; // 3s entre envíos

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normName(s) { return String(s || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); }

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/\D/g, "");

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "🛒", key: msg.key } });

  // Permisos
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  // Unimos todo para parsear por bloques "🔥addper"
  const full = args.join(" ").trim();
  // regex: 🔥addper <nombre> <hab1> <hab2> <imgUrl> <precioNum>
  const re = /(?:^|\s)🔥addper\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)(?=\s|$)/g;

  let match, bloques = [];
  while ((match = re.exec(full)) !== null) {
    const [_, nombre, hab1, hab2, imagen, precioStr] = match;
    bloques.push({ nombre, hab1, hab2, imagen, precio: parseInt(precioStr, 10) });
  }

  if (bloques.length === 0) {
    return conn.sendMessage(chatId, {
      text:
`✳️ *Uso de ejemplo (varios a la vez):*
.addper2 🔥addper 🔬Gen_Asagiri 🗣️Maestro_de_la_Persuasión 🧠Estratega_Agudo https://cdn.dorratz.com/files/1741679373398.jpg 89700 🔥addper 🏗️Kaseki 🔨Artesano_Supremo 🏛️Constructor_Ingenioso https://cdn.dorratz.com/files/1741679445577.jpg 79200 🔥addper 🍽️Francois 🏆Chef_Exquisito 🎩Mayordomo_Preciso https://cdn.dorratz.com/files/1741679594531.jpg 93800

📌 Formato de cada bloque:
🔥addper <Nombre> <Hab1> <Hab2> <ImagenURL> <Precio>`
    }, { quoted: msg });
  }

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let data = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath, "utf-8")) : {};
  if (!Array.isArray(data.personajes)) data.personajes = [];

  let agregados = 0, duplicados = 0, errores = 0;

  for (const blk of bloques) {
    try {
      // Validaciones básicas
      if (!blk.nombre || !blk.hab1 || !blk.hab2 || !blk.imagen || !Number.isInteger(blk.precio)) {
        errores++;
        await conn.sendMessage(chatId, { text: `⚠️ Datos incompletos para: ${blk.nombre || "(sin nombre)"} — se omite.` }, { quoted: msg });
        continue;
      }
      if (!/^https?:\/\//i.test(blk.imagen)) {
        errores++;
        await conn.sendMessage(chatId, { text: `⚠️ URL inválida para ${blk.nombre}: ${blk.imagen}` }, { quoted: msg });
        continue;
      }

      // Duplicado por nombre normalizado
      const yaExiste = data.personajes.some(p => normName(p.nombre) === normName(blk.nombre));
      if (yaExiste) {
        duplicados++;
        await conn.sendMessage(chatId, { text: `🔁 Ya existe: *${blk.nombre.replace(/_/g, " ")}*. Se omite.` }, { quoted: msg });
        continue;
      }

      const personaje = {
        nombre: blk.nombre,
        imagen: blk.imagen,
        precio: blk.precio,
        nivel: 1,
        habilidades: [
          { nombre: blk.hab1, nivel: 1 },
          { nombre: blk.hab2, nivel: 1 }
        ]
      };

      data.personajes.push(personaje);
      fs.writeFileSync(sukirpgPath, JSON.stringify(data, null, 2));

      const caption =
`✅ *Personaje agregado a la tienda*
⚔️ *Nombre:* ${blk.nombre.replace(/_/g, " ")}
💳 *Precio:* ${blk.precio} créditos
📈 *Nivel:* 1
☠️ *Habilidad 1:* ${blk.hab1.replace(/_/g, " ")} (Nv 1)
🐉 *Habilidad 2:* ${blk.hab2.replace(/_/g, " ")} (Nv 1)`;

      await conn.sendMessage(chatId, {
        image: { url: blk.imagen },
        caption
      }, { quoted: msg });

      agregados++;
      await sleep(PAUSA_MS); // 3 segundos entre cada envío

    } catch (e) {
      errores++;
      await conn.sendMessage(chatId, { text: `❌ Error al agregar ${blk.nombre || "(sin nombre)"}: ${String(e.message || e)}` }, { quoted: msg });
    }
  }

  // Resumen final
  const resumen =
`🧾 *addper2 — Resumen*
➕ Agregados: ${agregados}
🔁 Duplicados: ${duplicados}
⚠️ Errores: ${errores}`;
  await conn.sendMessage(chatId, { text: resumen }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["addper2"];
export default handler;
