import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "💳", key: msg.key } });

  // Cargar DB
  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
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

  if (!prestamosUsuario.length) {
    return conn.sendMessage(chatId, {
      text: "✅ No tienes préstamos activos por pagar.",
      quoted: msg
    });
  }

  const prestamo = prestamosUsuario[0];
  const prestamoIndex = db.banco.prestamos.findIndex(p => p.id === prestamo.id);

  // Asegurar campos
  const pendiente = Number(prestamo.pendiente ?? Math.ceil((prestamo.cantidadSolicitada || prestamo.cantidad || 0) * (1 + (prestamo.tasa ?? 0.20))));
  const disponible = (Number(usuario.creditos) || 0) + (Number(usuario.guardado) || 0);

  if (pendiente <= 0) {
    // Nada que pagar; limpiamos por si quedó marcado activo con 0
    db.banco.prestamos.splice(prestamoIndex, 1);
    fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));
    return conn.sendMessage(chatId, {
      text: "✅ Tu préstamo ya estaba liquidado. Se removió del sistema.",
      quoted: msg
    });
  }

  if (disponible < pendiente) {
    return conn.sendMessage(chatId, {
      text: `❌ No tienes fondos suficientes para pagar todo.\n💳 Necesitas *${pendiente}* y tienes *${disponible}* (créditos + guardado).\nUsa *.pagar <monto>* para abonar parcial.`,
      quoted: msg
    });
  }

  // Descontar del usuario: primero creditos, luego guardado
  let aPagar = pendiente;
  let pagadoDesdeCreditos = 0;
  let pagadoDesdeGuardado = 0;

  if ((usuario.creditos || 0) >= aPagar) {
    usuario.creditos -= aPagar;
    pagadoDesdeCreditos = aPagar;
    aPagar = 0;
  } else {
    pagadoDesdeCreditos = usuario.creditos || 0;
    aPagar -= (usuario.creditos || 0);
    usuario.creditos = 0;

    const guard = usuario.guardado || 0;
    const usarGuard = Math.min(guard, aPagar);
    usuario.guardado = guard - usarGuard;
    pagadoDesdeGuardado = usarGuard;
    aPagar -= usarGuard;
  }

  const pagadoTotal = pagadoDesdeCreditos + pagadoDesdeGuardado;

  // Actualizar banco y préstamo
  prestamo.pagado = (Number(prestamo.pagado) || 0) + pagadoTotal;
  prestamo.pendiente = 0;
  prestamo.estado = "pagado";

  if (typeof db.banco.montoTotal !== "number") db.banco.montoTotal = 0;
  db.banco.montoTotal += pagadoTotal; // el banco recupera capital

  // Quitar el préstamo del arreglo para evitar duplicaciones futuras
  if (prestamoIndex >= 0) {
    db.banco.prestamos.splice(prestamoIndex, 1);
  }

  fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

  // === FACTURA DE PAGO TOTAL ===
  try {
    const canvas = createCanvas(800, 500);
    const ctx = canvas.getContext("2d");

    // Fondo
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Logo del banco circular
    const logo = await loadImage("https://cdn.russellxz.click/9f08a046.jpeg");
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
    ctx.fillText("¥FACTURA DE PAGO (TOTAL)", 200, 60);

    const fechaPagoTxt = new Date().toLocaleString();
    const tasa = prestamo.tasa ? (prestamo.tasa * 100).toFixed(0) : "20";
    const totalAPagar = Number(prestamo.totalAPagar ?? Math.ceil((prestamo.cantidadSolicitada || prestamo.cantidad || 0) * (1 + (prestamo.tasa ?? 0.20))));

    ctx.font = "20px Sans-serif";
    ctx.fillText(`➤ Cliente: ${usuario.nombre} ${usuario.apellido}`, 220, 120);
    ctx.fillText(`➤ Pago total realizado: ${pagadoTotal} créditos`, 220, 160);
    ctx.fillText(`➤ Interés aplicado al préstamo: ${tasa}%`, 220, 200);
    ctx.fillText(`➤ Total del préstamo: ${totalAPagar} créditos`, 220, 230);
    ctx.fillText(`➤ Pagado acumulado: ${totalAPagar} créditos`, 220, 260);
    ctx.fillText(`➤ Pendiente por pagar: 0 créditos`, 220, 290);
    ctx.fillText(`➤ Fecha de pago: ${fechaPagoTxt}`, 220, 320);

    // Sello verde
    ctx.fillStyle = "#28a745";
    ctx.font = "bold 40px Sans-serif";
    ctx.fillText("✔ PRÉSTAMO LIQUIDADO", 200, 440);

    const buffer = canvas.toBuffer("image/png");

    await conn.sendMessage(chatId, {
      image: buffer,
      caption: `🎉 *¡Has liquidado tu préstamo por completo!* Gracias por ponerte al día.\n(El préstamo fue removido del sistema para evitar duplicaciones.)`,
      quoted: msg
    });
  } catch (e) {
    // Fallback en texto si canvas falla
    await conn.sendMessage(chatId, {
      text:
        `🎉 *¡Has liquidado tu préstamo!* (El préstamo fue removido del sistema)\n` +
        `Cliente: *${usuario.nombre} ${usuario.apellido}*\n` +
        `Pago total: *${pendiente}* créditos`,
      quoted: msg
    });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["pagarall"];
export default handler;
