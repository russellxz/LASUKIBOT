// factura-imagen.js — Dibuja la factura como imagen.
//
// Si la tienda tiene nombre y logo se usan; si no, la factura sale igual de
// presentable con el nombre del grupo y un logo con la inicial.
// Si por lo que sea canvas no está disponible, devuelve null y quien llama
// manda solo el texto: el sistema nunca se queda sin poder cobrar.

import { fecha, textoCiclo } from "./facturacion-core.js";

let canvasMod = null;
let canvasRoto = false;

async function cargarCanvas() {
  if (canvasMod || canvasRoto) return canvasMod;
  try {
    canvasMod = await import("canvas");
  } catch (e) {
    canvasRoto = true;
    console.log("[factura] sin canvas, las facturas irán solo en texto:", e.message);
  }
  return canvasMod;
}

const COLORES = {
  pendiente: { fuerte: "#f59e0b", suave: "#fef3c7", sello: "PENDIENTE" },
  pagada:    { fuerte: "#16a34a", suave: "#dcfce7", sello: "PAGADA" },
  anulada:   { fuerte: "#6b7280", suave: "#f3f4f6", sello: "ANULADA" },
  vencida:   { fuerte: "#dc2626", suave: "#fee2e2", sello: "VENCIDA" }
};

/** Recorta el texto para que quepa en el ancho dado */
function ajustar(ctx, texto, ancho) {
  let s = String(texto ?? "");
  if (ctx.measureText(s).width <= ancho) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > ancho) s = s.slice(0, -1);
  return s + "…";
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {object} factura   la factura de facturacion-core
 * @param {object} opciones  { tienda, logo, producto, clienteNombre, cliente }
 * @returns {Promise<Buffer|null>}
 */
export async function generarFacturaImagen(factura, opciones = {}) {
  const mod = await cargarCanvas();
  if (!mod) return null;

  try {
    const { createCanvas, loadImage } = mod.default || mod;
    const W = 1000, H = 620;
    const cv = createCanvas(W, H);
    const ctx = cv.getContext("2d");

    const estado = COLORES[factura.estado] || COLORES.pendiente;
    const nombreTienda = (opciones.tienda || "TIENDA").toUpperCase();

    // ---------- Fondo ----------
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, 140);
    // Franja de color del estado
    ctx.fillStyle = estado.fuerte;
    ctx.fillRect(0, 140, W, 8);

    // ---------- Logo ----------
    const LX = 40, LY = 25, LS = 90;
    let logoPuesto = false;
    if (opciones.logo) {
      try {
        const img = await loadImage(
          Buffer.isBuffer(opciones.logo) ? opciones.logo : opciones.logo
        );
        ctx.save();
        ctx.beginPath();
        ctx.arc(LX + LS / 2, LY + LS / 2, LS / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, LX, LY, LS, LS);
        ctx.restore();
        logoPuesto = true;
      } catch {}
    }
    if (!logoPuesto) {
      // Sin logo: círculo con la inicial de la tienda
      ctx.fillStyle = estado.fuerte;
      ctx.beginPath();
      ctx.arc(LX + LS / 2, LY + LS / 2, LS / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 46px Sans-Serif";
      ctx.textAlign = "center";
      ctx.fillText(nombreTienda.charAt(0) || "T", LX + LS / 2, LY + LS / 2 + 16);
      ctx.textAlign = "left";
    }

    // ---------- Cabecera ----------
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px Sans-Serif";
    ctx.fillText(ajustar(ctx, nombreTienda, 560), 155, 62);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px Sans-Serif";
    ctx.fillText(`Factura N.º ${factura.numero || factura.id}`, 155, 95);
    ctx.fillText(`Emitida: ${fecha(factura.generada)}`, 155, 120);

    // Sello de estado arriba a la derecha
    ctx.font = "bold 22px Sans-Serif";
    const anchoSello = ctx.measureText(estado.sello).width + 44;
    ctx.fillStyle = estado.fuerte;
    redondeado(ctx, W - anchoSello - 40, 45, anchoSello, 46, 23);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(estado.sello, W - anchoSello / 2 - 40, 76);
    ctx.textAlign = "left";

    // ---------- Cuerpo ----------
    const filas = [
      ["Cliente", opciones.clienteNombre || `+${factura.cliente}`],
      ["Producto", String(opciones.producto || factura.producto).toUpperCase()],
      ["Ciclo de cobro", textoCiclo(factura.ciclo)],
      ["Vence", fecha(factura.vence)]
    ];

    let y = 200;
    for (const [etiqueta, valor] of filas) {
      ctx.fillStyle = "#64748b";
      ctx.font = "17px Sans-Serif";
      ctx.fillText(etiqueta.toUpperCase(), 50, y);

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 22px Sans-Serif";
      ctx.fillText(ajustar(ctx, valor, 560), 50, y + 28);

      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(50, y + 46);
      ctx.lineTo(620, y + 46);
      ctx.stroke();

      y += 72;
    }

    // ---------- Importe ----------
    ctx.fillStyle = estado.suave;
    redondeado(ctx, 660, 190, 290, 180, 18);
    ctx.fill();

    ctx.fillStyle = "#475569";
    ctx.font = "18px Sans-Serif";
    ctx.textAlign = "center";
    ctx.fillText("TOTAL A PAGAR", 805, 232);

    ctx.fillStyle = estado.fuerte;
    ctx.font = "bold 62px Sans-Serif";
    ctx.fillText(String(factura.monto), 805, 300);

    ctx.fillStyle = "#475569";
    ctx.font = "20px Sans-Serif";
    ctx.fillText("créditos", 805, 336);
    ctx.textAlign = "left";

    // ---------- Cómo pagar ----------
    ctx.fillStyle = "#f8fafc";
    redondeado(ctx, 40, 500, W - 80, 80, 14);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 21px Sans-Serif";
    ctx.fillText(
      factura.estado === "pagada"
        ? "✔ Factura pagada. ¡Gracias por tu compra!"
        : 'Para pagar: responde a este mensaje escribiendo  "pagar"',
      66,
      533
    );

    ctx.fillStyle = "#64748b";
    ctx.font = "17px Sans-Serif";
    ctx.fillText(
      factura.estado === "pagada"
        ? "El servicio sigue activo hasta el próximo cobro."
        : "Se descuenta de tus créditos. Si no te alcanza, pídele créditos a un admin.",
      66,
      560
    );

    return cv.toBuffer("image/png");
  } catch (e) {
    console.error("[factura] no se pudo dibujar la imagen:", e.message);
    return null;
  }
}

/** El texto que acompaña a la imagen (y que se manda solo si no hay imagen) */
export function textoFactura(factura, opciones = {}) {
  const tienda = opciones.tienda || "Tienda";
  const producto = String(opciones.producto || factura.producto).toUpperCase();
  const cabecera =
    factura.estado === "pagada"
      ? `✅ *FACTURA PAGADA*`
      : `🧾 *NUEVA FACTURA*`;

  const lineas = [
    `${cabecera}`,
    ``,
    `🏪 *Tienda:* ${tienda}`,
    `🔖 *Factura:* N.º ${factura.numero || factura.id}`,
    `📦 *Producto:* ${producto}`,
    `👤 *Cliente:* +${factura.cliente}`,
    `💵 *Total:* ${factura.monto} créditos`,
    `🔁 *Ciclo:* ${textoCiclo(factura.ciclo)}`,
    `📅 *Emitida:* ${fecha(factura.generada)}`,
    `⏳ *Vence:* ${fecha(factura.vence)}`
  ];

  if (factura.estado === "pendiente") {
    lineas.push(
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💳 *PARA PAGAR*`,
      `Responde a este mensaje escribiendo *pagar*.`,
      `Se descuenta de tus créditos automáticamente.`,
      ``,
      `Si no te alcanza, pídele créditos a un administrador del grupo.`,
      ``,
      `⚠️ Tienes hasta el *${fecha(factura.vence)}*. Si no pagas para entonces,`,
      `el servicio se cancela y la cuenta se libera.`
    );
  } else if (factura.estado === "pagada") {
    lineas.push(``, `Gracias por tu compra 🙌`);
  }

  return lineas.join("\n");
}
