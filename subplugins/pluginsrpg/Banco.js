// plugins/banco.js
import fs from 'fs';
import path from 'path';

function formatoTiempo(msRestante) {
  if (!Number.isFinite(msRestante) || msRestante <= 0) return "⏳ Tiempo vencido";
  const segundos = Math.floor(msRestante / 1000);
  const dias = Math.floor(segundos / (3600 * 24));
  const horas = Math.floor((segundos % (3600 * 24)) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const segs = segundos % 60;

  const partes = [];
  if (dias > 0) partes.push(`${dias}d`);
  if (horas > 0) partes.push(`${horas}h`);
  if (minutos > 0) partes.push(`${minutos}m`);
  if (segs > 0) partes.push(`${segs}s`);
  return partes.join(" ");
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, { react: { text: "🏦", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(sukirpgPath)) {
    return conn.sendMessage(chatId, {
      text: "❌ Aún no existe la base de datos del RPG.",
      quoted: msg
    });
  }

  const db = JSON.parse(fs.readFileSync(sukirpgPath, "utf-8")) || {};
  db.banco = db.banco || null;

  if (!db.banco) {
    return conn.sendMessage(chatId, {
      text: "🏦 No hay un banco configurado. Un owner debe usar *.addbank* primero.",
      quoted: msg
    });
  }

  db.banco.montoTotal = Number(db.banco.montoTotal) || 0;
  db.banco.prestamos = Array.isArray(db.banco.prestamos) ? db.banco.prestamos : [];

  const totalPrestamos = db.banco.prestamos.length;

  // 📌 Instrucciones de uso
  let caption =
`🏦 *BANCO RPG - Instrucciones de uso*\n
💰 *Pedir préstamo:*
.prestamo <cantidad>
Ej: .prestamo 5000

💳 *Pagar parte de la deuda:*
.pagar <cantidad>
Ej: .pagar 2000

💳 *Pagar toda la deuda:*
.pagarall

──────────────────
💳 *Capital disponible:* ${db.banco.montoTotal} créditos
🧾 *Préstamos activos:* ${totalPrestamos}\n`;

  if (totalPrestamos === 0) {
    caption += `\n📌 No hay usuarios con préstamos activos ahora mismo.`;
    return conn.sendMessage(chatId, {
      image: { url: "https://cdn.russellxz.click/00877f21.jpeg" },
      caption,
      quoted: msg
    });
  }

  const ahora = Date.now();
  const mentions = [];

  let sumaPrestado = 0;
  let sumaTotalAPagar = 0;
  let sumaPagado = 0;
  let sumaPendiente = 0;

  caption += `\n👥 *Detalle de préstamos:*\n`;

  db.banco.prestamos.forEach((p, i) => {
    const numero = String(p.numero || "");
    const tag = `${numero}@s.whatsapp.net`;
    mentions.push(tag);

    const nombre = `${p.nombre || "Usuario"} ${p.apellido || ""}`.trim();
    const prestado = Number((p.cantidadSolicitada != null ? p.cantidadSolicitada : p.cantidad) || 0);
    const totalAPagar = Number((p.totalAPagar != null ? p.totalAPagar : Math.ceil(prestado * 1.20)));
    const pagado = Number(p.pagado || 0);
    const pendiente = Number(p.pendiente != null ? p.pendiente : Math.max(totalAPagar - pagado, 0));

    sumaPrestado += prestado;
    sumaTotalAPagar += totalAPagar;
    sumaPagado += pagado;
    sumaPendiente += pendiente;

    const msRestante = (Number(p.fechaLimite) || 0) - ahora;
    const tiempoRestante = formatoTiempo(msRestante);

    caption +=
      `\n*${i + 1}.* @${numero}\n` +
      `   • Nombre: ${nombre}\n` +
      `   • Prestado: ${prestado} créditos\n` +
      `   • Total a pagar (20%): ${totalAPagar} créditos\n` +
      `   • Pagado: ${pagado} créditos\n` +
      `   • Pendiente: ${pendiente} créditos\n` +
      `   • Tiempo restante: ${tiempoRestante}`;
  });

  caption +=
    `\n\n📊 *Totales:*\n` +
    `   • Prestado: ${sumaPrestado} créditos\n` +
    `   • Total a pagar: ${sumaTotalAPagar} créditos\n` +
    `   • Pagado: ${sumaPagado} créditos\n` +
    `   • Pendiente: ${sumaPendiente} créditos`;

  await conn.sendMessage(chatId, {
    image: { url: "https://cdn.russellxz.click/00877f21.jpeg" },
    caption,
    mentions,
    quoted: msg
  });
};

handler.command = ["banco"];
export default handler;
