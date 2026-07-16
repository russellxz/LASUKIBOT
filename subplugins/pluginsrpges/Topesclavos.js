// plugins/topesclavos.js
// Comando: .topesclavos / .topes
// Muestra el top de dueños con más esclavos ACTIVOS (únicos), con imagen y menciones de TODOS los esclavos.

import fs from 'fs';
import path from 'path';

const PORTADA_URL = "https://cdn.russellxz.click/42bd53d7.jpeg";
const MAX_ITEMS = 10; // muestra top 10

function cargarDB(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "📊", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = cargarDB(sukirpgPath);

  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.esclavos = Array.isArray(db.esclavos) ? db.esclavos : [];

  const ahora = Date.now();

  // Mapa: owner -> Set de slaves (solo contratos activos)
  const mapa = new Map();

  for (const c of db.esclavos) {
    try {
      const owner = String(c.dueno || c.owner || "");
      const slave = String(c.objetivo || c.slave || "");
      const fin   = Number(c.hasta || c.fin || 0);
      const escapado = Boolean(c.escapado);

      if (!owner || !slave) continue;
      if (escapado) continue;
      if (!fin || fin <= ahora) continue; // solo activos

      if (!mapa.has(owner)) mapa.set(owner, new Set());
      mapa.get(owner).add(slave);
    } catch {}
  }

  if (mapa.size === 0) {
    return conn.sendMessage(chatId, {
      text: "📭 No hay esclavos activos todavía. Usa *.tiendaes* para ver disponibles.",
      quoted: msg
    });
  }

  // Armar ranking
  const ranking = [];
  for (const [owner, setSlaves] of mapa.entries()) {
    ranking.push({ owner, slaves: Array.from(setSlaves), total: setSlaves.size });
  }

  ranking.sort((a, b) => b.total - a.total);

  // Texto del top
  let texto = "🏆 *TOP DUEÑOS DE ESCLAVOS (activos)*\n";
  texto += "Los puestos se ordenan por cantidad de esclavos únicos activos.\n";
  texto += "────────────────────\n";

  const menciones = new Set();

  const top = ranking.slice(0, MAX_ITEMS);
  top.forEach((item, idx) => {
    const pos = idx + 1;
    // dueños y esclavos mencionados
    menciones.add(`${item.owner}@s.whatsapp.net`);
    item.slaves.forEach(s => menciones.add(`${s}@s.whatsapp.net`));

    const esclavosTxt = item.slaves.length
      ? item.slaves.map(s => `@${s}`).join(", ")
      : "—";

    texto += `${pos}. @${item.owner} — 🧑‍🤝‍🧑 *${item.total}* esclavo(s)\n`;
    texto += `   👥 Esclavos: ${esclavosTxt}\n`;
    texto += "────────────────────\n";
  });

  // Envío con imagen + caption
  try {
    await conn.sendMessage(chatId, {
      image: { url: PORTADA_URL },
      caption: texto.trim(),
      mentions: Array.from(menciones),
      quoted: msg
    });
  } catch {
    // fallback sin imagen
    await conn.sendMessage(chatId, {
      text: texto.trim(),
      mentions: Array.from(menciones),
      quoted: msg
    });
  }

  // Reacción final
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["topesclavos", "topes"];
export default handler;
