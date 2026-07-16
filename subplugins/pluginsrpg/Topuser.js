import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "🏅", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];

  if (db.usuarios.length === 0) {
    return conn.sendMessage(chatId, {
      text: "❌ No hay usuarios registrados en el RPG.",
      quoted: msg
    });
  }

  // Helper para máximo por nivel
  const maxByNivel = (arr = []) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.reduce((best, cur) => (cur.nivel > (best?.nivel || 0) ? cur : best), null);
  };

  // Construir ranking
  const ranking = db.usuarios.map(u => {
    const personajes = Array.isArray(u.personajes) ? u.personajes : [];
    const mascotas   = Array.isArray(u.mascotas)   ? u.mascotas   : [];

    const totalNivelPersonajes = personajes.reduce((acc, p) => acc + (p.nivel || 0), 0);
    const totalNivelMascotas   = mascotas.reduce((acc, m) => acc + (m.nivel || 0), 0);
    const totalNivelTodo       = totalNivelPersonajes + totalNivelMascotas;

    const topMascota    = maxByNivel(mascotas);
    const topPersonaje  = maxByNivel(personajes);

    return {
      numero: u.numero,
      nombre: u.nombre || "Desconocido",
      apellido: u.apellido || "",
      nivelUsuario: u.nivel || 0,
      totalNivelTodo,
      cantMascotas: mascotas.length,
      cantPersonajes: personajes.length,
      topMascota,
      topPersonaje,
    };
  })
  // Orden: 1) nivel del usuario DESC, 2) total niveles de todo DESC, 3) cantidad total DESC
  .sort((a, b) => {
    if (b.nivelUsuario !== a.nivelUsuario) return b.nivelUsuario - a.nivelUsuario;
    if (b.totalNivelTodo !== a.totalNivelTodo) return b.totalNivelTodo - a.totalNivelTodo;
    const totA = a.cantMascotas + a.cantPersonajes;
    const totB = b.cantMascotas + b.cantPersonajes;
    return totB - totA;
  });

  // Armar mensaje
  let texto = `🏅 *TOP USUARIOS (por nivel de usuario, luego niveles acumulados)*\n\n`;
  ranking.forEach((u, i) => {
    const topMasTxt = u.topMascota ? `${u.topMascota.nombre} (Nivel ${u.topMascota.nivel})` : "—";
    const topPerTxt = u.topPersonaje ? `${u.topPersonaje.nombre} (Nivel ${u.topPersonaje.nivel})` : "—";
    texto += `*${i + 1}.* @${u.numero}\n`;
    texto += `👤 *${u.nombre} ${u.apellido}*\n`;
    texto += `🧬 *Nivel de usuario:* ${u.nivelUsuario}\n`;
    texto += `📊 *Niveles acumulados (mascotas + personajes):* ${u.totalNivelTodo}\n`;
    texto += `🐾 *Mascotas:* ${u.cantMascotas}  |  🎭 *Personajes:* ${u.cantPersonajes}\n`;
    texto += `💪 *Mascota más poderosa:* ${topMasTxt}\n`;
    texto += `⚔️ *Personaje más poderoso:* ${topPerTxt}\n`;
    texto += `────────────────\n`;
  });

  // Enviar con imagen y menciones reales
  await conn.sendMessage(chatId, {
    image: { url: "https://cdn.russellxz.click/038c23a2.jpeg" },
    caption: texto,
    mentions: ranking.map(u => `${u.numero}@s.whatsapp.net`),
    quoted: msg
  });
};

handler.command = ["topuser"];
export default handler;
