// plugins/pluginsventas/Menuventas.js — Menú de todos los comandos de ventas.
// El diseño, la imagen/video y el nombre salen de la personalización (setmenu).
import { enviarMenu } from "../../disenos.js";
import { ventasConfiguradas } from "../../ventas-core.js";

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

// Comandos de ventas que no siguen el patrón "x / setx"
const APARTE = [
  ["sorteo", "sortea entre los que reaccionen"],
  ["addfactura", "guarda una factura"],
  ["delfactura", "borra una factura"],
  ["facpaga", "marca una factura como pagada"],
  ["verfac", "lista las facturas del grupo"]
];

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "🛒", key: msg.key } }, msg); } catch {}

  // Lo que este chat ya tiene configurado, para marcarlo con ✅
  let puestos = new Set();
  try { puestos = new Set(ventasConfiguradas(chatId)); } catch {}

  const total = GRUPOS.reduce((n, g) => n + g.items.length, 0);
  const listos = GRUPOS.reduce(
    (n, g) => n + g.items.filter((c) => puestos.has(c)).length,
    0
  );

  const secciones = GRUPOS.map((g) => ({
    titulo: g.titulo,
    items: g.items.map((c) => `${p}${c}${puestos.has(c) ? "  ✅" : ""}`)
  }));

  secciones.push({
    titulo: "🧾 FACTURAS Y SORTEOS",
    items: APARTE.map(([c, d]) => `${p}${c} — ${d}`)
  });

  secciones.unshift({
    titulo: "📝 CÓMO SE USA",
    items: [
      `${p}<comando> — muestra lo guardado`,
      `${p}set<comando> <texto> — lo configura`,
      `Responde a una imagen con ${p}set<comando> para ponerle foto`,
      `Ejemplo: ${p}setstock 10 cuentas Netflix`
    ]
  });

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
