// plugins/prestamo.js
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const MAX_PRESTAMO = 250000; // Tope acumulado por préstamo activo

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🏦", key: msg.key } });

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  let db = fs.existsSync(sukirpgPath) ? JSON.parse(fs.readFileSync(sukirpgPath)) : {};
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.banco = db.banco || null;

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado. Usa `.rpg nombre apellido edad fechaNacimiento` para registrarte.",
      quoted: msg
    });
  }

  if (!db.banco) {
    return conn.sendMessage(chatId, {
      text: "🏦 No hay banco configurado. Un owner debe usar `.addbank`.",
      quoted: msg
    });
  }

  if (!args[0]) {
    return conn.sendMessage(chatId, {
      text: "✳️ *Uso correcto:*\n.prestamo <cantidad>\n📌 Ej: `.prestamo 5000`",
      quoted: msg
    });
  }

  const cantidad = parseInt(args[0], 10);
  if (isNaN(cantidad) || cantidad <= 0) {
    return conn.sendMessage(chatId, { text: "❌ La cantidad debe ser un número mayor que 0.", quoted: msg });
  }

  const capitalDisponible = typeof db.banco.montoTotal === "number" ? db.banco.montoTotal : 0;
  if (cantidad > capitalDisponible) {
    return conn.sendMessage(chatId, {
      text: `❌ El banco solo tiene *${capitalDisponible}* créditos disponibles.`,
      quoted: msg
    });
  }

  const tasaInteres = (typeof db.banco.tasaInteres === "number" ? db.banco.tasaInteres : 0.20);
  const plazoMs = (db.banco.plazo && typeof db.banco.plazo.ms === "number")
    ? db.banco.plazo.ms
    : (typeof db.banco.tiempoLimite === "number" ? db.banco.tiempoLimite : 0);

  if (!plazoMs || plazoMs <= 0) {
    return conn.sendMessage(chatId, {
      text: "❌ El banco no tiene un plazo válido. Reconfigura con `.addbank <monto> <tiempo>`.",
      quoted: msg
    });
  }

  // Buscar préstamo ACTIVO del usuario
  db.banco.prestamos = Array.isArray(db.banco.prestamos) ? db.banco.prestamos : [];
  let prestamoActivo = db.banco.prestamos.find(p => p.numero === numero && p.estado === "activo");

  // ====== VALIDACIÓN DEL TOPE ACUMULADO (250k) ======
  if (prestamoActivo) {
    const yaSolicitado = Number(prestamoActivo.cantidadSolicitada || 0);
    const nuevoTotal = yaSolicitado + cantidad;
    if (nuevoTotal > MAX_PRESTAMO) {
      const restante = Math.max(0, MAX_PRESTAMO - yaSolicitado);
      return conn.sendMessage(chatId, {
        text:
`🚫 *Tope de préstamo alcanzado.*
🧮 Ya tienes solicitado: *${yaSolicitado}* créditos.
🔝 Máximo permitido por préstamo: *${MAX_PRESTAMO}* créditos.
${restante > 0 ? `👉 Aún puedes solicitar hasta *${restante}* créditos.` : "👉 Debes cancelar tu deuda para volver a pedir."}`,
        quoted: msg
      });
    }
  } else {
    // Si es un préstamo nuevo, no se puede pedir más del tope en una sola vez
    if (cantidad > MAX_PRESTAMO) {
      return conn.sendMessage(chatId, {
        text: `🚫 No puedes solicitar más de *${MAX_PRESTAMO}* créditos en un solo préstamo.`,
        quoted: msg
      });
    }
  }
  // ====== FIN VALIDACIÓN TOPE ======

  const ahora = Date.now();

  // Crédito neto que recibe el usuario (siempre la cantidad solicitada)
  usuario.creditos = (usuario.creditos || 0) + cantidad;
  db.banco.montoTotal = capitalDisponible - cantidad;

  // Costo total de ESTA solicitud (principal + interés)
  const extraConInteres = Math.ceil(cantidad * (1 + tasaInteres));

  if (prestamoActivo) {
    // === AMPLIACIÓN DEL PRÉSTAMO EXISTENTE ===
    prestamoActivo.cantidadSolicitada = (prestamoActivo.cantidadSolicitada || 0) + cantidad;
    prestamoActivo.totalAPagar       = (prestamoActivo.totalAPagar || 0) + extraConInteres;
    prestamoActivo.pendiente         = (prestamoActivo.pendiente || 0) + extraConInteres;

    // Mantengo fechaLimite igual (no se reinicia el plazo)
    prestamoActivo.historial = Array.isArray(prestamoActivo.historial) ? prestamoActivo.historial : [];
    prestamoActivo.historial.push({
      fecha: ahora,
      tipo: "ampliacion",
      solicitado: cantidad,
      extraAPagar: extraConInteres
    });

    fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

    // Comprobante visual de AMPLIACIÓN (Canvas)
    try {
      const canvas = createCanvas(800, 500);
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const logo = await loadImage("https://cdn.russellxz.click/f44a9e20.jpeg");
      ctx.save();
      ctx.beginPath();
      ctx.arc(80, 80, 60, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logo, 20, 20, 120, 120);
      ctx.restore();

      ctx.fillStyle = "#000";
      ctx.font = "bold 30px Sans-serif";
      ctx.fillText("¥AMPLIACIÓN DE PRÉSTAMO", 220, 60);

      ctx.font = "20px Sans-serif";
      ctx.fillText(`➤ Cliente: ${usuario.nombre} ${usuario.apellido}`, 220, 120);
      ctx.fillText(`➤ Nueva cantidad: ${cantidad} créditos`, 220, 160);
      ctx.fillText(`➤ Interés: ${(tasaInteres * 100).toFixed(0)}%`, 220, 200);
      ctx.fillText(`➤ Extra a pagar: ${extraConInteres} créditos`, 220, 230);
      ctx.fillText(`➤ Pendiente total: ${prestamoActivo.pendiente} créditos`, 220, 260);
      ctx.fillText(`➤ Fecha límite (sin cambios): ${new Date(prestamoActivo.fechaLimite).toLocaleString()}`, 220, 290);

      ctx.fillText(`⚠ Si no pagas a tiempo, perderás tu personaje principal`, 220, 330);
      ctx.fillText(`   o, si no tienes, una de tus mascotas será eliminada.`, 220, 355);

      ctx.fillStyle = "#10b981";
      ctx.font = "bold 36px Sans-serif";
      ctx.fillText("✔ AMPLIACIÓN APLICADA", 210, 420);

      const buffer = canvas.toBuffer("image/png");
      await conn.sendMessage(chatId, {
        image: buffer,
        caption:
          `🧾 *Ampliación de préstamo aplicada*\n` +
          `💰 +${cantidad} créditos depositados.\n` +
          `➕ Se suman *${extraConInteres}* créditos a tu deuda (interés ${Math.round(tasaInteres * 100)}%).\n` +
          `🧮 *Pendiente total ahora:* ${prestamoActivo.pendiente} créditos.\n` +
          `⏳ *Vence:* ${new Date(prestamoActivo.fechaLimite).toLocaleString()}\n\n` +
          `📌 Para pagar, usa: *.pagarall*`,
        quoted: msg
      });
    } catch {
      await conn.sendMessage(chatId, {
        text:
          `🧾 *Ampliación de préstamo aplicada*\n` +
          `Cliente: *${usuario.nombre} ${usuario.apellido}*\n` +
          `Nueva cantidad: *${cantidad}* créditos\n` +
          `Extra a pagar (con interés): *${extraConInteres}* créditos\n` +
          `Pendiente total ahora: *${prestamoActivo.pendiente}* créditos\n` +
          `Vence: *${new Date(prestamoActivo.fechaLimite).toLocaleString()}*\n\n` +
          `📌 Para pagar, usa: *.pagarall*`,
        quoted: msg
      });
    }

  } else {
    // === NUEVO PRÉSTAMO ===
    const fechaInicio = ahora;
    const fechaLimite = fechaInicio + plazoMs;

    const prestamo = {
      id: `${numero}_${fechaInicio}`,
      numero,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      cantidadSolicitada: cantidad,
      tasa: tasaInteres,
      totalAPagar: extraConInteres,
      pagado: 0,
      pendiente: extraConInteres,
      fechaInicio,
      fechaLimite,
      grupo: chatId,
      estado: "activo",
      historial: [
        { fecha: ahora, tipo: "aprobado", solicitado: cantidad, totalAPagar: extraConInteres }
      ],
      snapshot: {
        creditos: usuario.creditos || 0,
        guardado: usuario.guardado || 0
      }
    };
    db.banco.prestamos.push(prestamo);
    fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

    try {
      const canvas = createCanvas(800, 500);
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const logo = await loadImage("https://cdn.russellxz.click/f44a9e20.jpeg");
      ctx.save();
      ctx.beginPath();
      ctx.arc(80, 80, 60, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logo, 20, 20, 120, 120);
      ctx.restore();

      ctx.fillStyle = "#000";
      ctx.font = "bold 30px Sans-serif";
      ctx.fillText("¥FACTURA DE PRÉSTAMO", 220, 60);

      ctx.font = "20px Sans-serif";
      ctx.fillText(`➤ Cliente: ${usuario.nombre} ${usuario.apellido}`, 220, 120);
      ctx.fillText(`➤ Cantidad prestada: ${cantidad} créditos`, 220, 160);
      ctx.fillText(`➤ Interés: ${(tasaInteres * 100).toFixed(0)}%`, 220, 200);
      ctx.fillText(`➤ Total a pagar: ${extraConInteres} créditos`, 220, 230);
      ctx.fillText(`➤ Fecha de inicio: ${new Date(fechaInicio).toLocaleString()}`, 220, 260);
      ctx.fillText(`➤ Fecha límite de pago: ${new Date(fechaLimite).toLocaleString()}`, 220, 290);

      ctx.fillText(`⚠ Si no pagas a tiempo, perderás tu personaje principal`, 220, 330);
      ctx.fillText(`   o, si no tienes, una de tus mascotas será eliminada.`, 220, 355);

      ctx.fillStyle = "#28a745";
      ctx.font = "bold 40px Sans-serif";
      ctx.fillText("✔ PRÉSTAMO APROBADO", 200, 420);

      const buffer = canvas.toBuffer("image/png");
      await conn.sendMessage(chatId, {
        image: buffer,
        caption:
          `✅ *Préstamo aprobado*\n` +
          `💳 Se han depositado *${cantidad}* créditos.\n` +
          `🧮 Total a pagar (interés ${Math.round(tasaInteres * 100)}%): *${extraConInteres}*.\n\n` +
          `📌 Para pagar: *.pagarall*`,
        quoted: msg
      });
    } catch {
      await conn.sendMessage(chatId, {
        text:
          `✅ *Préstamo aprobado*\n` +
          `Cliente: *${usuario.nombre} ${usuario.apellido}*\n` +
          `Monto: *${cantidad}* créditos\n` +
          `Interés: *${Math.round(tasaInteres * 100)}%*\n` +
          `Total a pagar: *${extraConInteres}* créditos\n` +
          `Inicio: *${new Date(ahora).toLocaleString()}*\n` +
          `Vence: *${new Date(ahora + plazoMs).toLocaleString()}*\n\n` +
          `📌 Para pagar: *.pagarall*`,
        quoted: msg
      });
    }
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["prestamo"];
export default handler;
