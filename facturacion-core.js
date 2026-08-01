// facturacion-core.js — Núcleo del sistema de ventas con facturación.
//
// Cada GRUPO es una tienda independiente. Dentro de un grupo:
//   • productos  → lo que se vende (stock, netflix, ...). Cada producto tiene
//                  foto, texto y una lista de CUENTAS.
//   • cuentas    → los datos que se le entregan al cliente (correo, contraseña,
//                  PIN... lo que el admin escriba), con su precio en créditos y
//                  su ciclo de facturación.
//   • ventas     → una cuenta ya vendida a un cliente, con su próxima factura.
//   • facturas   → cada cobro generado al cumplirse el ciclo.
//   • creditos   → saldo de cada cliente en esa tienda.
//   • avisos     → números que reciben en privado las facturas de los clientes.
//
// La foto y el texto siguen guardándose en ventas365.json (el formato de
// siempre) para no perder nada de lo que ya está configurado.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(RAIZ, "facturacion.json");

// Cada cuánto revisa el sistema si toca generar facturas
export const INTERVALO_REVISION_MS = 20 * 1000;

// ------------------------------------------------------------
// Lectura y escritura
// ------------------------------------------------------------
let cache = null;
let cacheMtime = 0;

function leer() {
  try {
    const stat = fs.statSync(ARCHIVO);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    cache = JSON.parse(fs.readFileSync(ARCHIVO, "utf-8")) || {};
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch {
    cache = cache || {};
    return cache;
  }
}

function guardar(datos) {
  cache = datos;
  fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2));
  try { cacheMtime = fs.statSync(ARCHIVO).mtimeMs; } catch {}
}

/** La tienda de un grupo, creándola si hace falta */
function tienda(datos, chatId) {
  if (!datos[chatId]) {
    datos[chatId] = {
      nombre: "",
      logo: null,
      avisos: [],
      creditos: {},
      productos: {},
      ventas: [],
      facturas: [],
      contador: 0
    };
  }
  const t = datos[chatId];
  t.avisos ||= [];
  t.creditos ||= {};
  t.productos ||= {};
  t.ventas ||= [];
  t.facturas ||= [];
  t.contador ||= 0;
  return t;
}

export function getTienda(chatId) {
  return tienda(leer(), chatId);
}

/** Aplica un cambio sobre la tienda y lo guarda */
export function editarTienda(chatId, fn) {
  const datos = leer();
  const t = tienda(datos, chatId);
  const r = fn(t);
  guardar(datos);
  return r;
}

/** Todos los grupos que tienen algo configurado */
export function gruposConTienda() {
  return Object.keys(leer());
}

function nuevoId(t, prefijo) {
  t.contador = (t.contador || 0) + 1;
  return `${prefijo}${t.contador}`;
}

export const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// ------------------------------------------------------------
// Ciclos de facturación
// ------------------------------------------------------------
/**
 * Entiende "30d" (días) y "5m" (minutos, pensado para probar el sistema
 * sin esperar días). También acepta "30 dias", "1 dia", "15".
 */
export function parseCiclo(texto) {
  const s = String(texto || "").trim().toLowerCase();
  const m = s.match(/^(\d+)\s*([dm]|d[ií]as?|min(?:utos?)?)?$/);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1) return null;

  const u = (m[2] || "d").startsWith("m") ? "m" : "d";
  if (u === "d" && n > 3650) return null;
  if (u === "m" && n > 525600) return null;
  return { n, u };
}

export function msCiclo(ciclo) {
  if (!ciclo) return 0;
  return ciclo.u === "m" ? ciclo.n * 60 * 1000 : ciclo.n * 24 * 60 * 60 * 1000;
}

export function textoCiclo(ciclo) {
  if (!ciclo) return "sin ciclo";
  if (ciclo.u === "m") return `cada ${ciclo.n} minuto${ciclo.n === 1 ? "" : "s"}`;
  return `cada ${ciclo.n} día${ciclo.n === 1 ? "" : "s"}`;
}

/** "en 2 días 3 h" / "en 15 min" / "ya toca" */
export function tiempoRestante(hasta) {
  const ms = hasta - Date.now();
  if (ms <= 0) return "ya toca";

  const min = Math.floor(ms / 60000);
  if (min < 60) return `en ${min} min`;

  const h = Math.floor(min / 60);
  if (h < 24) return `en ${h} h ${min % 60} min`;

  const d = Math.floor(h / 24);
  return `en ${d} día${d === 1 ? "" : "s"} ${h % 24} h`;
}

export function fecha(ts) {
  try {
    return new Date(ts).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

// ------------------------------------------------------------
// Créditos
// ------------------------------------------------------------
export function getCreditos(chatId, numero) {
  return Number(getTienda(chatId).creditos?.[DIGITS(numero)] || 0);
}

export function sumarCreditos(chatId, numero, cantidad) {
  return editarTienda(chatId, (t) => {
    const k = DIGITS(numero);
    const nuevo = Math.max(0, Number(t.creditos[k] || 0) + Number(cantidad));
    t.creditos[k] = nuevo;
    return nuevo;
  });
}

// ------------------------------------------------------------
// Productos y cuentas
// ------------------------------------------------------------
function producto(t, clave) {
  if (!t.productos[clave]) t.productos[clave] = { cuentas: [] };
  t.productos[clave].cuentas ||= [];
  return t.productos[clave];
}

export function getCuentas(chatId, clave) {
  return getTienda(chatId).productos?.[clave]?.cuentas || [];
}

/** Cuentas que todavía no se le han vendido a nadie */
export function cuentasLibres(chatId, clave) {
  return getCuentas(chatId, clave).filter((c) => !c.vendidaA);
}

export function agregarCuenta(chatId, clave, { datos, precio, ciclo }) {
  return editarTienda(chatId, (t) => {
    const p = producto(t, clave);
    const cuenta = {
      id: nuevoId(t, "c"),
      datos: String(datos || ""),
      precio: Number(precio) || 0,
      ciclo,
      vendidaA: null,
      creada: Date.now()
    };
    p.cuentas.push(cuenta);
    return cuenta;
  });
}

export function quitarCuenta(chatId, clave, cuentaId) {
  return editarTienda(chatId, (t) => {
    const p = producto(t, clave);
    const i = p.cuentas.findIndex((c) => c.id === cuentaId);
    if (i < 0) return null;
    const [fuera] = p.cuentas.splice(i, 1);
    // Si estaba vendida, la venta queda cancelada
    for (const v of t.ventas) {
      if (v.cuentaId === cuentaId && v.estado === "activa") v.estado = "cancelada";
    }
    return fuera;
  });
}

export function cambiarCicloCuenta(chatId, clave, cuentaId, ciclo) {
  return editarTienda(chatId, (t) => {
    const p = producto(t, clave);
    const cuenta = p.cuentas.find((c) => c.id === cuentaId);
    if (!cuenta) return null;
    cuenta.ciclo = ciclo;
    // La venta en curso pasa a facturarse con el ciclo nuevo
    for (const v of t.ventas) {
      if (v.cuentaId === cuentaId && v.estado === "activa") {
        v.ciclo = ciclo;
        v.proxima = Date.now() + msCiclo(ciclo);
      }
    }
    return cuenta;
  });
}

// ------------------------------------------------------------
// Números que reciben las facturas
// ------------------------------------------------------------
export function getAvisos(chatId) {
  return getTienda(chatId).avisos || [];
}

export function agregarAviso(chatId, numero) {
  return editarTienda(chatId, (t) => {
    const n = DIGITS(numero);
    if (!n || n.length < 7) return null;
    if (!t.avisos.includes(n)) t.avisos.push(n);
    return n;
  });
}

export function quitarAviso(chatId, numero) {
  return editarTienda(chatId, (t) => {
    const n = DIGITS(numero);
    const i = t.avisos.indexOf(n);
    if (i < 0) return null;
    t.avisos.splice(i, 1);
    return n;
  });
}

// ------------------------------------------------------------
// Ventas
// ------------------------------------------------------------
/**
 * Le vende una cuenta a un cliente. Descuenta los créditos, deja la cuenta
 * marcada como vendida y programa la primera factura para dentro de un ciclo.
 */
export function comprar(chatId, clave, cuentaId, cliente) {
  return editarTienda(chatId, (t) => {
    const p = producto(t, clave);
    const cuenta = p.cuentas.find((c) => c.id === cuentaId);
    if (!cuenta) return { error: "no_existe" };
    if (cuenta.vendidaA) return { error: "vendida" };

    const num = DIGITS(cliente);
    const saldo = Number(t.creditos[num] || 0);
    if (saldo < cuenta.precio) {
      return { error: "sin_creditos", saldo, precio: cuenta.precio };
    }

    t.creditos[num] = saldo - cuenta.precio;
    cuenta.vendidaA = num;

    const venta = {
      id: nuevoId(t, "v"),
      producto: clave,
      cuentaId: cuenta.id,
      cliente: num,
      precio: cuenta.precio,
      ciclo: cuenta.ciclo,
      inicio: Date.now(),
      proxima: Date.now() + msCiclo(cuenta.ciclo),
      estado: "activa",
      pagos: 1,
      totalPagado: cuenta.precio
    };
    t.ventas.push(venta);
    return { venta, cuenta, saldo: t.creditos[num] };
  });
}

export function ventasActivas(chatId) {
  return getTienda(chatId).ventas.filter((v) => v.estado === "activa");
}

export function cancelarVenta(chatId, ventaId) {
  return editarTienda(chatId, (t) => {
    const v = t.ventas.find((x) => x.id === ventaId);
    if (!v) return null;
    v.estado = "cancelada";
    const p = t.productos[v.producto];
    const cuenta = p?.cuentas?.find((c) => c.id === v.cuentaId);
    if (cuenta) cuenta.vendidaA = null;   // vuelve al stock disponible
    for (const f of t.facturas) {
      if (f.ventaId === ventaId && f.estado === "pendiente") f.estado = "anulada";
    }
    return v;
  });
}

export function borrarVenta(chatId, ventaId) {
  return editarTienda(chatId, (t) => {
    const i = t.ventas.findIndex((x) => x.id === ventaId);
    if (i < 0) return null;
    const [v] = t.ventas.splice(i, 1);
    const cuenta = t.productos[v.producto]?.cuentas?.find((c) => c.id === v.cuentaId);
    if (cuenta) cuenta.vendidaA = null;
    t.facturas = t.facturas.filter((f) => f.ventaId !== ventaId);
    return v;
  });
}

// ------------------------------------------------------------
// Facturas
// ------------------------------------------------------------
/** Ventas a las que ya les toca factura (y todavía no la tienen pendiente) */
export function ventasQueTocanFactura(chatId) {
  const t = getTienda(chatId);
  const ahora = Date.now();
  const conPendiente = new Set(
    t.facturas.filter((f) => f.estado === "pendiente").map((f) => f.ventaId)
  );
  return t.ventas.filter(
    (v) => v.estado === "activa" && v.proxima <= ahora && !conPendiente.has(v.id)
  );
}

export function crearFactura(chatId, ventaId) {
  return editarTienda(chatId, (t) => {
    const v = t.ventas.find((x) => x.id === ventaId);
    if (!v) return null;
    const factura = {
      id: nuevoId(t, "f"),
      ventaId: v.id,
      producto: v.producto,
      cliente: v.cliente,
      monto: v.precio,
      ciclo: v.ciclo,
      generada: Date.now(),
      vence: Date.now() + msCiclo(v.ciclo),
      estado: "pendiente",
      numero: t.facturas.length + 1
    };
    t.facturas.push(factura);
    return factura;
  });
}

export function facturasPendientes(chatId, cliente = null) {
  const num = cliente ? DIGITS(cliente) : null;
  return getTienda(chatId).facturas.filter(
    (f) => f.estado === "pendiente" && (!num || f.cliente === num)
  );
}

/**
 * Paga una factura con los créditos del cliente. Devuelve el motivo si no
 * se pudo, para poder avisarle bien.
 */
export function pagarFactura(chatId, facturaId) {
  return editarTienda(chatId, (t) => {
    const f = t.facturas.find((x) => x.id === facturaId);
    if (!f) return { error: "no_existe" };
    if (f.estado !== "pendiente") return { error: "ya_pagada" };

    const saldo = Number(t.creditos[f.cliente] || 0);
    if (saldo < f.monto) return { error: "sin_creditos", saldo, monto: f.monto };

    t.creditos[f.cliente] = saldo - f.monto;
    f.estado = "pagada";
    f.pagada = Date.now();

    const v = t.ventas.find((x) => x.id === f.ventaId);
    if (v) {
      v.pagos = (v.pagos || 0) + 1;
      v.totalPagado = (v.totalPagado || 0) + f.monto;
      v.proxima = Date.now() + msCiclo(v.ciclo);
    }
    return { factura: f, venta: v, saldo: t.creditos[f.cliente] };
  });
}

/**
 * ¿Este número tiene alguna factura pendiente en alguna tienda?
 * Lo usa el filtro de privados del bot para dejar pasar su "pagar".
 */
export function tienePendienteDePago(numero) {
  const num = DIGITS(numero);
  if (!num) return false;
  const datos = leer();
  for (const chatId of Object.keys(datos)) {
    const facturas = datos[chatId]?.facturas || [];
    if (facturas.some((f) => f.estado === "pendiente" && f.cliente === num)) return true;
  }
  return false;
}

/** Facturas pendientes de un cliente en TODAS las tiendas */
export function pendientesDeCliente(numero) {
  const num = DIGITS(numero);
  const datos = leer();
  const salida = [];
  for (const chatId of Object.keys(datos)) {
    for (const f of datos[chatId]?.facturas || []) {
      if (f.estado === "pendiente" && f.cliente === num) salida.push({ chatId, factura: f });
    }
  }
  return salida.sort((a, b) => a.factura.generada - b.factura.generada);
}

// ------------------------------------------------------------
// Resumen para .totalventas
// ------------------------------------------------------------
export function resumen(chatId) {
  const t = getTienda(chatId);
  const activas = t.ventas.filter((v) => v.estado === "activa");
  const pagadas = t.facturas.filter((f) => f.estado === "pagada");

  const ganancias =
    t.ventas.reduce((s, v) => s + (v.totalPagado || 0), 0);

  const productos = {};
  for (const v of activas) {
    productos[v.producto] = (productos[v.producto] || 0) + 1;
  }

  return {
    nombre: t.nombre || "",
    logo: t.logo || null,
    ventasActivas: activas.length,
    clientes: new Set(activas.map((v) => v.cliente)).size,
    facturasPagadas: pagadas.length,
    facturasPendientes: t.facturas.filter((f) => f.estado === "pendiente").length,
    ganancias,
    productos,
    avisos: t.avisos.length
  };
}
