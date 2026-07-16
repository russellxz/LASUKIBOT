import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "💳", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = db.usuarios || [];
  db.banco = db.banco || null;

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG. Usa `.rpg nombre apellido edad fechaNacimiento`.",
      quoted: msg
    });
  }

  if (!db.banco || !Array.isArray(db.banco.prestamos)) {
    return conn.sendMessage(chatId, {
      text: "🏦 No hay un banco configurado o no existen préstamos activos.",
      quoted: msg
    });
  }

  // Buscar el préstamo activo más reciente del usuario
  const prestamosUsuario = db.banco.prestamos
    .filter(p => p.numero === numero && p.estado === "activo")
    .sort((a, b) => b.fechaInicio - a.fechaInicio);

  const prestamoIndex = prestamosUsuario.length ? db.banco.prestamos.findIndex(p => p === prestamosUsuario[0]) : -1;
  const prestamo = prestamoIndex >= 0 ? db.banco.prestamos[prestamoIndex] : null;

  if (!prestamo) {
    return conn.sendMessage(chatId, {
      text: "✅ No tienes préstamos activos por pagar.",
      quoted: msg
    });
  }

  if (!args[0]) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Uso correcto:*\n.pagar <cantidad>\n📌 Ej: \`.pagar 1500\`\n\n💡 Deuda pendiente: *${prestamo.pendiente}* créditos.`,
      quoted: msg
    });
  }

  let pago = parseInt(args[0], 10);
  if (isNaN(pago) || pago <= 0) {
    return conn.sendMessage(chatId, {
      text: "❌ Ingresa una cantidad válida para pagar.",
      quoted: msg
    });
  }

  // Fondos del usuario (creditos + guardado si hace falta)
  const disponible = (usuario.creditos || 0) + (usuario.guardado || 0);
  if (pago > disponible) {
    return conn.sendMessage(chatId, {
      text: `❌ No tienes fondos suficientes.\n💳 Disponible: *${disponible}* (créditos + guardado)`,
      quoted: msg
    });
  }

  // No permitir pagar más de lo pendiente
  if (pago > prestamo.pendiente) pago = prestamo.pendiente;

  // Descontar del usuario: primero creditos, luego guardado
  let restante = pago;
  if (usuario.creditos >= restante) {
    usuario.creditos -= restante;
    restante = 0;
  } else {
    restante -= usuario.creditos;
    usuario.creditos = 0;
    usuario.guardado = Math.max(0, (usuario.guardado || 0) - restante);
    restante = 0;
  }

  // Actualizar préstamo y banco
  prestamo.pagado = (prestamo.pagado || 0) + pago;
  prestamo.pendiente = Math.max(0, prestamo.totalAPagar - prestamo.pagado);
  if (typeof db.banco.montoTotal !== "number") db.banco.montoTotal = 0;
  db.banco.montoTotal += pago; // el banco recupera capital

  // Si ya quedó en 0, marcar liquidado y remover del sistema
  let liquidado = false;
  if (prestamo.pendiente === 0) {
    prestamo.estado = "pagado";
    // Eliminar el préstamo del arreglo para evitar duplicaciones futuras
    db.banco.prestamos.splice(prestamoIndex, 1);
    liquidado = true;
  }

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // === FACTURA DE PAGO (mismo diseño que préstamo) ===
  try {
    const canvas = createCanvas(800, 500);
    const ctx = canvas.getContext("2d");

    // Fondo
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Logo del banco circular
    const logo = await loadImage("https://cdn.russellxz.click/f44a9e20.jpeg");
    ctx.save();
    ctx.beginPath();
    ctx.arc(80, 80, 60, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, 20, 20, 120, 120);
    ctx.restore();

    // Título
    ctx.fillStyle = "#000";
    ctx.font = "bold 30px Sans-serif";
    ctx.fillText("¥FACTURA DE PAGO", 220, 60);

    const fechaPagoTxt = new Date().toLocaleString();
    const tasa = prestamo.tasa ? (prestamo.tasa * 100).toFixed(0) : "20";

    ctx.font = "20px Sans-serif";
    ctx.fillText(`➤ Cliente: ${usuario.nombre} ${usuario.apellido}`, 220, 120);
    ctx.fillText(`➤ Pago realizado: ${pago} créditos`, 220, 160);
    ctx.fillText(`➤ Interés aplicado al préstamo: ${tasa}%`, 220, 200);
    ctx.fillText(`➤ Total del préstamo: ${prestamo.totalAPagar || (prestamo.cantidad || 0) * 1.2} créditos`, 220, 230);
    ctx.fillText(`➤ Pagado acumulado: ${(prestamo.pagado || 0)} créditos`, 220, 260);
    ctx.fillText(`➤ Pendiente por pagar: ${prestamo.pendiente || 0} créditos`, 220, 290);
    ctx.fillText(`➤ Fecha de pago: ${fechaPagoTxt}`, 220, 320);
    ctx.fillText(`⚠ Si no cancelas a tiempo, el banco podrá tomar tu personaje`, 220, 355);
    ctx.fillText(`   principal o, en su defecto, una mascota.`, 220, 380);

    // Sello verde
    ctx.fillStyle = "#28a745";
    ctx.font = "bold 40px Sans-serif";
    ctx.fillText(liquidado ? "✔ PRÉSTAMO LIQUIDADO" : "✔ PAGO REGISTRADO", 170, 440);

    const buffer = canvas.toBuffer("image/png");

    await conn.sendMessage(chatId, {
      image: buffer,
      caption:
        liquidado
          ? `🎉 *¡Has liquidado tu préstamo!* Gracias por ponerte al día.\n\n(El préstamo fue removido del sistema para evitar duplicaciones.)`
          : `✅ *Pago registrado*\n💳 Abonaste *${pago}* créditos.\n🧮 Pendiente actual: *${prestamo.pendiente}* créditos.`,
      quoted: msg
    });
  } catch (e) {
    // Fallback en texto si canvas falla
    await conn.sendMessage(chatId, {
      text:
        (liquidado
          ? `🎉 *¡Has liquidado tu préstamo!* (El préstamo fue removido del sistema)\n`
          : `✅ *Pago registrado*\n`) +
        `Cliente: *${usuario.nombre} ${usuario.apellido}*\n` +
        `Monto pagado: *${pago}* créditos\n` +
        `Pagado acumulado: *${prestamo.pagado || 0}*\n` +
        `Pendiente actual: *${prestamo.pendiente || 0}*`,
      quoted: msg
    });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["pagar"];
export default handler;
