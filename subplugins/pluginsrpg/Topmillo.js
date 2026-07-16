// plugins/topmillonarios.js
import fs from 'fs';
import path from 'path';

const LIMIT_TOP = 15; // cambia si quieres más/menos en el ranking

function formatNum(n) {
  return Number(n || 0).toLocaleString("es-ES");
}

const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "💰", key: msg.key } });

  // Cargar DB
  const dbPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(dbPath)) {
    return conn.sendMessage(chatId, {
      text: "❌ No existe la base de datos del RPG (sukirpg.json).",
      quoted: msg
    });
  }

  let db;
  try {
    db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  } catch {
    return conn.sendMessage(chatId, {
      text: "❌ Error leyendo la base de datos.",
      quoted: msg
    });
  }

  const usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  if (!usuarios.length) {
    return conn.sendMessage(chatId, {
      text: "🚫 No hay usuarios registrados aún.",
      quoted: msg
    });
  }

  // Construir tabla con totales
  const tabla = usuarios.map(u => {
    const numero = String(u.numero || "");
    const afuera = Number(u.creditos || 0);
    const guardado = Number(u.guardado || 0);
    const total = afuera + guardado;
    const cntPer = Array.isArray(u.personajes) ? u.personajes.length : 0;
    const cntMas = Array.isArray(u.mascotas) ? u.mascotas.length : 0;
    const nombre = `${u.nombre || "Usuario"} ${u.apellido || ""}`.trim();
    return { numero, nombre, afuera, guardado, total, cntPer, cntMas };
  });

  // Orden descendente por total
  tabla.sort((a, b) => b.total - a.total);

  // Armar caption
  const top = tabla.slice(0, LIMIT_TOP);
  const mentions = top.map(t => `${t.numero}@s.whatsapp.net`);

  let caption = `💎 *TOP MILLONARIOS* 💎\n` +
                `Ranking por *total de créditos* (afuera + guardado)\n\n`;

  top.forEach((t, idx) => {
    caption += `*${idx + 1}.* @${t.numero}\n` +
               `   • Nombre: ${t.nombre}\n` +
               `   • Afuera: ${formatNum(t.afuera)} 💳\n` +
               `   • Guardado: ${formatNum(t.guardado)} 💼\n` +
               `   • Total: ${formatNum(t.total)} 🏦\n` +
               `   • Personajes: ${t.cntPer} | Mascotas: ${t.cntMas}\n` +
               `─────────────────\n`;
  });

  // Enviar imagen con el caption y las menciones
  await conn.sendMessage(
    chatId,
    {
      image: { url: "https://cdn.russellxz.click/2a36adc2.jpeg" },
      caption,
      mentions
    },
    { quoted: msg }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["topmillonarios", "topmillo"];
export default handler;
