// plugins/pluginsventas/Menuventas.js — Menú de todos los comandos de ventas.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../../disenos.js";
import { ventasConfiguradas } from "../../ventas-core.js";
import { comandosCreados } from "./Crear.js";

// Cada grupo lleva el comando que MUESTRA el contenido. Para configurarlo se
// usa el mismo nombre con "set" delante (stock → setstock).
const GRUPOS = [
  {
    titulo: "🎬 STREAMING",
    items: ["netflix", "disney", "hbo", "prime", "vix", "spotifyventa", "youtube", "universal"]
  },
  {
    titulo: "🎮 GAMING",
    items: ["robux", "diamantes", "gamepass", "pasesff", "fragmentos", "maxeo"]
  },
  {
    titulo: "📦 STOCK",
    items: [
      "stock", "stock2", "stock3", "stock4", "stock5",
      "stock6", "stock7", "stock8", "stock9", "stock10"
    ]
  },
  {
    titulo: "🎁 COMBOS · LOTES · PAQUETES",
    items: [
      "combo", "combos", "combos2", "combos3", "combos4", "combos5",
      "lote", "lotes",
      "paquete", "paquete2", "paquete3", "paquete4", "paquete5"
    ]
  },
  {
    titulo: "💳 PAGOS Y PRECIOS",
    items: [
      "pago", "pago2", "pago3", "pago4", "pago5",
      "preciosbot", "descuentos", "promo", "promoday",
      "tanda", "recargas", "reembolsos", "rebote"
    ]
  },
  {
    titulo: "📄 TRÁMITES Y DOCUMENTOS",
    items: [
      "tramites", "actas", "certificados", "constancias", "justificantes",
      "rfc", "imss", "citas", "universidad", "libros", "recetas",
      "facturas", "procesos", "vigencia"
    ]
  },
  {
    titulo: "🚌 VIAJES",
    items: ["ado", "autobus", "boletos", "vuelos"]
  },
  {
    titulo: "🛠️ SERVICIOS Y VARIOS",
    items: [
      "servicios", "seguros", "alimentos", "shein", "numerovirtual",
      "programas", "metodo", "metodos", "adicionales", "pedrial",
      "dinamica", "peliculas", "canvas", "reglas", "soporte",
      "seguidores", "duos", "trios"
    ]
  },
  {
    titulo: "📊 REPORTES Y CÓDIGOS",
    items: ["reportes", "fichareportes", "linkreportes", "codigos", "linkcodigos"]
  }
];

// Comandos del sistema, que no siguen el patrón "x / setx"
const APARTE = [
  ["crear <nombre>", "crea un producto nuevo con su comando"],
  ["crear borrar <nombre>", "borra uno creado, si no tiene clientes"],
  ["addcredit @cliente 50", "dale créditos a un cliente"],
  ["totalventas", "panel: clientes, cobros y ganancias"],
  ["sorteo", "sortea entre los que reaccionen"]
];

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "🛒", key: msg.key } }, msg); } catch {}

  // Lo que este chat ya tiene configurado, para marcarlo con ✅
  let puestos = new Set();
  try { puestos = new Set(ventasConfiguradas(chatId)); } catch {}

  // Los que el propio usuario creó con .crear
  let creados = [];
  try { creados = comandosCreados(); } catch {}

  const todos = [...GRUPOS.flatMap((g) => g.items), ...creados.map((c) => c.clave)];
  const total = todos.length;
  const listos = todos.filter((c) => puestos.has(c)).length;

  const secciones = GRUPOS.map((g) => ({
    titulo: g.titulo,
    items: g.items.map((c) => `${p}${c}${puestos.has(c) ? "  ✅" : ""}`)
  }));

  // Y van en su propio apartado del menú
  if (creados.length) {
    secciones.push({
      titulo: "🧩 CREADOS POR TI",
      items: creados.map(
        (c) => `${p}${c.clave}${puestos.has(c.clave) ? "  ✅" : ""}`
      )
    });
  }

  secciones.push({
    titulo: "⚙️ SISTEMA DE VENTAS",
    items: APARTE.map(([c, d]) => `${p}${c} — ${d}`)
  });

  secciones.unshift(
    {
      titulo: "📝 PARA EL ADMIN",
      items: [
        `${p}set<comando> — abre el menú de configuración`,
        `Dentro eliges por número: foto, texto, cuentas...`,
        `Cada cuenta lleva su precio y su ciclo de cobro`,
        `${p}crear setojo — inventa un producto nuevo`,
        `${p}addcredit @cliente 50 — dale saldo para comprar`
      ]
    },
    {
      titulo: "🛒 PARA EL CLIENTE",
      items: [
        `${p}<comando> — ve el producto y las cuentas`,
        `${p}<comando> 1 — compra la cuenta número 1`,
        `Los datos llegan al privado, nunca al grupo`,
        `Cuando toque el cobro llega una factura`,
        `Se paga respondiendo *pagar* a la factura`
      ]
    }
  );

  return enviarMenu(conn, chatId, msg, "menuventas", {
    titulo: "MENÚ DE VENTAS",
    info: [
      ["Comandos de ventas", total],
      ["Configurados aquí", `${listos} de ${total}`],
      ["Prefijo", p]
    ],
    secciones,
    nota:
      listos === 0
        ? `Todavía no hay nada configurado en este chat. Empieza con *${p}setstock <texto>*`
        : "Los ✅ son los que ya tienen contenido guardado en este chat 🛒"
  });
};

handler.command = ["menuventas", "menuventa", "venta"];
handler.help = ["menuventas"];
handler.tags = ["menu", "ventas"];
handler.register = true;

export default handler;
