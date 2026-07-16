// plugins/veresclavos.js
// Comando: .veres / .veresclavos
// Lista los esclavos del dueño con tiempo restante del contrato,
// próxima recompensa, y acumulados Ganado / Perdido / Neto.

import fs from 'fs';
import path from 'path';

function cargarDB(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

function formatoTiempo(msRestante) {
  if (!Number.isFinite(msRestante) || msRestante <= 0) return "⏳ Terminado";
  const s = Math.floor(msRestante / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const partes = [];
  if (d) partes.push(`${d}d`);
  if (h) partes.push(`${h}h`);
  if (m) partes.push(`${m}m`);
  partes.push(`${sec}s`); // siempre segundos
  return partes.join(" ");
}

function moneda(n) {
  return Number(n || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const ownerNum = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "📜", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  const db = cargarDB(sukirpgPath);

  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.esclavos = Array.isArray(db.esclavos) ? db.esclavos : [];

  const ownerUser = db.usuarios.find(u => String(u.numero) === ownerNum);
  if (!ownerUser) {
    return conn.sendMessage(
      chatId,
      { text: "❌ No estás registrado en el RPG." },
      { quoted: msg }
    );
  }

  const ahora = Date.now();
  const esclavosDueño = db.esclavos.filter(c =>
    String(c.dueno || c.owner) === ownerNum && Number(c.hasta || c.fin) > ahora
  );

  if (!esclavosDueño.length) {
    return conn.sendMessage(
      chatId,
      { text: "📭 No tienes esclavos activos actualmente." },
      { quoted: msg }
    );
  }

  let totalGanado = 0;
  let totalPerdido = 0;

  let texto = `👑 *TUS ESCLAVOS* @${ownerNum}\n`;
  texto += "────────────────────\n";

  const menciones = new Set([`${ownerNum}@s.whatsapp.net`]);

  esclavosDueño.forEach((c, i) => {
    const slaveNum = String(c.objetivo || c.slave);
    const hasta = Number(c.hasta || c.fin);
    const restanteContrato = formatoTiempo(hasta - ahora);

    const nextReward = Number(c.nextRewardAt || 0);
    const restanteReward = nextReward > 0 ? formatoTiempo(nextReward - ahora) : "⏳ No programada";

    const ganado = Number(c.totalGanado || c.ganado || 0);
    const perdido = Number(c.totalPerdido || c.perdidas || 0);
    const neto = ganado - perdido;

    totalGanado += ganado;
    totalPerdido += perdido;

    texto += `${i + 1}. @${slaveNum}\n`;
    texto += `   ⏳ Contrato: ${restanteContrato}\n`;
    texto += `   ⏱ Próxima recompensa en: ${restanteReward}\n`;
    texto += `   💹 Ganado: *${moneda(ganado)}*  |  💢 Perdido: *${moneda(perdido)}*  |  ⚖️ Neto: *${moneda(neto)}*\n`;
    texto += "────────────────────\n";

    menciones.add(`${slaveNum}@s.whatsapp.net`);
  });

  const totalNeto = totalGanado - totalPerdido;

  texto += `📊 *Totales*\n`;
  texto += `   💹 Ganado: *${moneda(totalGanado)}*\n`;
  texto += `   💢 Perdido: *${moneda(totalPerdido)}*\n`;
  texto += `   ⚖️ Neto: *${moneda(totalNeto)}*\n`;

  await conn.sendMessage(
    chatId,
    { text: texto, mentions: Array.from(menciones) },
    { quoted: msg }
  );
};

handler.command = ["veres", "veresclavos"];
export default handler;
