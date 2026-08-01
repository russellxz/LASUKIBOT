// plugins/pluginsventas/Crear.js — Crea comandos de ventas nuevos sobre la marcha.
//
//   .crear setojo   →  crea  .setojo  (configurar, admins)  y  .ojo  (clientes)
//
// Los comandos creados se guardan en ventas-creados.json y se vuelven a
// registrar solos cada vez que arranca el bot. No hace falta reiniciar: al
// crearlos quedan disponibles al instante.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { crearVenta } from "../../ventas-core.js";
import { isAdminByNumber, isOwnerCheck, numeroDelRemitente } from "../../libs/adminCheck.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVO = path.join(RAIZ, "ventas-creados.json");

// Nombres que no se pueden usar (los ocupa el propio sistema)
const RESERVADOS = new Set([
  "crear", "addcredit", "totalventas", "menuventas", "menuventa", "venta",
  "pagar", "menu", "sorteo", "reglas"
]);

function leer() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, "utf-8")) || [];
  } catch {
    return [];
  }
}

function guardar(lista) {
  fs.writeFileSync(ARCHIVO, JSON.stringify(lista, null, 2));
}

/** Mete el comando en el bot que ya está corriendo */
function registrarEnCaliente(def) {
  const handler = crearVenta(def);
  global.plugins = global.plugins || [];
  global.plugins.push(handler);
  if (typeof global.buildPluginIndex === "function") global.buildPluginIndex();
  return handler;
}

// Al cargar este archivo se vuelven a dar de alta los comandos ya creados.
// global.plugins existe antes de que el bot recorra la carpeta de plugins.
export function cargarComandosCreados() {
  const lista = leer();
  let n = 0;
  for (const def of lista) {
    try {
      registrarEnCaliente(def);
      n++;
    } catch (e) {
      console.error(`[crear] no se pudo registrar ${def?.clave}:`, e.message);
    }
  }
  if (n) console.log(`🛒 [ventas] ${n} comando(s) de ventas creados por el usuario`);
  return n;
}
cargarComandosCreados();

/** ¿Ese nombre ya lo usa algún comando del bot? */
function yaExiste(nombre) {
  const n = String(nombre).toLowerCase();
  if (RESERVADOS.has(n)) return true;
  if (global.pluginIndex?.has?.(n)) return true;
  return (global.plugins || []).some((p) => {
    const c = Array.isArray(p?.command) ? p.command : [];
    return c.some((x) => String(x).toLowerCase() === n);
  });
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
  const responder = (text) => conn.sendMessage(chatId, { text }, { quoted: msg });

  // Permisos: admin del grupo u owner
  const quien = numeroDelRemitente(msg);
  const permitido =
    msg.key.fromMe ||
    isOwnerCheck(quien) ||
    (chatId.endsWith("@g.us") && (await isAdminByNumber(conn, chatId, quien)));

  if (!permitido) {
    return responder("🚫 Solo administradores u owners pueden crear comandos de ventas.");
  }

  const pedido = String(args?.[0] || "").trim().toLowerCase().replace(/^[./#!]/, "");

  if (!pedido) {
    const creados = leer();
    return responder(
      [
        `🧩 *CREAR COMANDOS DE VENTAS*`,
        ``,
        `Con esto creas un producto nuevo con su comando para clientes y su`,
        `comando de configuración, igual que ${pref}stock o ${pref}netflix.`,
        ``,
        `*Cómo se usa:*`,
        `*${pref}crear setojo*`,
        ``,
        `Y quedan listos al momento:`,
        `• *${pref}setojo* — para el admin: foto, texto, cuentas, precios y ciclo`,
        `• *${pref}ojo* — para el cliente: ve el producto y compra`,
        ``,
        `También vale escribirlo sin el "set": *${pref}crear ojo* hace lo mismo.`,
        ``,
        creados.length
          ? `*Ya creados (${creados.length}):*\n` +
            creados.map((c) => `• ${pref}${c.clave}`).join("\n") +
            `\n\n🗑️ Para borrar uno: *${pref}crear borrar <nombre>*`
          : `_Todavía no has creado ninguno._`
      ].join("\n")
    );
  }

  // ---------- Borrar ----------
  if (pedido === "borrar" || pedido === "delete") {
    const nombre = String(args?.[1] || "").trim().toLowerCase().replace(/^set/, "");
    const lista = leer();
    const i = lista.findIndex((c) => c.clave === nombre);
    if (i < 0) {
      return responder(`❌ No hay ningún comando creado que se llame *${nombre}*.`);
    }
    const [fuera] = lista.splice(i, 1);
    guardar(lista);

    // Quitarlo del bot en caliente
    global.plugins = (global.plugins || []).filter((p) => p?.ventas?.clave !== fuera.clave);
    if (typeof global.buildPluginIndex === "function") global.buildPluginIndex();

    return responder(
      `🗑️ *${fuera.titulo}* borrado.\n\n` +
        `Los comandos *${pref}${fuera.clave}* y *${pref}set${fuera.clave}* ya no existen.\n` +
        `_Lo que tuvieras configurado sigue guardado por si lo vuelves a crear._`
    );
  }

  // ---------- Crear ----------
  const clave = pedido.replace(/^set/, "");

  if (!/^[a-z0-9]{2,20}$/.test(clave)) {
    return responder(
      `⚠️ El nombre solo puede llevar letras y números, entre 2 y 20 caracteres.\n\n` +
        `Ejemplo: *${pref}crear setojo*`
    );
  }
  if (yaExiste(clave) || yaExiste(`set${clave}`)) {
    return responder(
      `⚠️ El comando *${pref}${clave}* ya existe en el bot.\n\nElige otro nombre.`
    );
  }

  const titulo = clave.charAt(0).toUpperCase() + clave.slice(1);
  const def = {
    clave,
    comandos: [clave],
    setComandos: [`set${clave}`],
    titulo,
    emoji: "🛒"
  };

  const lista = leer();
  lista.push(def);
  guardar(lista);
  registrarEnCaliente(def);

  return responder(
    [
      `✅ *COMANDO CREADO*`,
      ``,
      `🛒 *${titulo}* ya está funcionando, sin reiniciar nada.`,
      ``,
      `*Para el admin:*`,
      `*${pref}set${clave}* — abre el menú para poner foto, texto, agregar`,
      `cuentas con su precio y su ciclo de facturación.`,
      ``,
      `*Para los clientes:*`,
      `*${pref}${clave}* — ven el producto y las cuentas disponibles`,
      `*${pref}${clave} 1* — compran la cuenta número 1`,
      ``,
      `Empieza ahora con *${pref}set${clave}*`
    ].join("\n")
  );
};

handler.command = ["crear"];
handler.help = ["crear <nombre>"];
handler.tags = ["ventas"];

export default handler;
