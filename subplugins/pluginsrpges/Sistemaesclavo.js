// plugins/esclavos_recompensas.js
// Recompensas por esclavos SIN enviar pagos al chat (anti-spam).
// Paga internamente por tick y actualiza totales para que .veres lo muestre en tiempo real.
// Además: cuando hay evento NEGATIVO (5%), se NOTIFICA en el chat (agrupado por dueño).

import fs from 'fs';
import path from 'path';

// === Config (modo TEST) ===
const INTERVALO_MS    = 15 * 1000;     // cada cuánto revisa la DB
const BASE_TICK_MS    = 2 * 60 * 1000; // cada cuánto se programa una recompensa por contrato (~2min)
const JITTER_MS_MAX   = 30 * 1000;     // jitter 0..30s
const CHANCE_NEGATIVO = 0.0014; // ~0.14% de probabilidad por tick ≈ 1 vez/día por esclavo
const DECIMALES       = 0;

let running = false;
let _intervalRef = null;

// Tabla de contrato (rangos totales por todo el contrato) — referencia
const TABLA_CONTRATO = {
  1: { precio: 25000,  totalMin: 35000,  totalMax: 40000  },
  2: { precio: 50000,  totalMin: 60000,  totalMax: 65000  },
  3: { precio: 75000,  totalMin: 85000,  totalMax: 90000  },
  4: { precio: 100000, totalMin: 110000, totalMax: 115000 },
  5: { precio: 125000, totalMin: 135000, totalMax: 140000 }
};

// Escala por tick (si el rango base era horario)
function escalaTick() {
  return BASE_TICK_MS / (60 * 60 * 1000); // ej: 2min -> 1/30 de una hora
}

const rnd    = (min, max) => Math.random() * (max - min) + min;
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now    = () => Date.now();

function moneda(n) {
  return Number(n || 0).toLocaleString("es-ES", { maximumFractionDigits: DECIMALES });
}

function horasDeContrato(dias) {
  return clamp((Number(dias) || 0) * 24, 1, 24 * 365);
}

function resumenPorHora(dias) {
  const cfg = TABLA_CONTRATO[dias];
  if (!cfg) return { baseMinH: 0, baseMaxH: 0, precio: 0 };
  const horas = horasDeContrato(dias);
  const baseMinH = Math.max(1, Math.floor(cfg.totalMin / horas));
  const baseMaxH = Math.max(1, Math.floor(cfg.totalMax / horas));
  return { baseMinH, baseMaxH, precio: cfg.precio };
}

// Próximo tick alineado a buckets (evita que todos paguen al mismo segundo)
function proximoTick(baseMs = BASE_TICK_MS) {
  const t = Date.now();
  const bucket = Math.ceil((t + 1) / baseMs) * baseMs; // siguiente múltiplo
  const jitter = Math.floor(Math.random() * JITTER_MS_MAX);
  return bucket + jitter;
}

function safeUser(db, numero) {
  return db.usuarios?.find(u => String(u.numero) === String(numero));
}
function ensureArrays(db) {
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.esclavos = Array.isArray(db.esclavos) ? db.esclavos : [];
  db.banco = db.banco || null;
}

// Textos de eventos NEGATIVOS (10). Se mencionan {owner} y {slave}.
const TEXTOS_NEGATIVOS = [
  "💥 {slave} cometió un error costoso; {owner} perdió 💳 {monto}.",
  "🧨 {slave} dañó equipo crítico; {owner} cubrió 💳 {monto}.",
  "🌀 {slave} tuvo un día fatal; pérdidas para {owner}: 💳 {monto}.",
  "❌ {slave} falló una entrega; {owner} penalizado con 💳 {monto}.",
  "🪫 {slave} bajó el rendimiento; {owner} perdió 💳 {monto}.",
  "🧯 {slave} provocó un incidente menor; {owner} pagó 💳 {monto}.",
  "🧾 {slave} hizo mal las cuentas; ajuste para {owner}: 💳 {monto}.",
  "🛠️ {slave} rompió herramientas; {owner} desembolsó 💳 {monto}.",
  "🏃‍♂️ {slave} se escapó por unas horas, pero lo capturaste; el caos te costó 💳 {monto}.",
  "🌧️ Mala racha para {slave}; {owner} asumió pérdidas por 💳 {monto}."
];

// Procesa pagos; envía mensaje SOLO cuando hay eventos negativos (agrupado por dueño)
async function procesarRecompensas(conn) {
  if (running) return;
  running = true;

  const file = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(file)) { running = false; return; }

  let db;
  try { db = JSON.parse(fs.readFileSync(file, "utf-8")) || {}; }
  catch { running = false; return; }

  ensureArrays(db);

  const t = now();
  const scale = escalaTick(); // ej: 2min -> 1/30

  // Para notificaciones agrupadas de negativos: owner -> { chat, lines:[], mentions:Set }
  const negativosPorDueno = new Map();

  // Recorremos contratos
  for (let i = db.esclavos.length - 1; i >= 0; i--) {
    const c = db.esclavos[i];
    try {
      // Normalización / compat
      c.owner = String(c.owner || c.dueno || c.ownerId || "");
      c.slave = String(c.slave || c.esclavo || c.objetivo || "");
      if (!c.owner || !c.slave) continue;

      c.dias           = Number(c.dias   || 0);
      c.precio         = Number(c.precio || 0);
      c.inicio         = Number(c.inicio || c.desde || t);
      c.fin            = Number(c.fin    || c.hasta || (c.inicio + c.dias * 24 * 60 * 60 * 1000));
      c.nextRewardAt   = Number(c.nextRewardAt || c.proximaRecompensa || proximoTick());
      c.totalGanado    = Number(c.totalGanado   || 0);
      c.totalPerdido   = Number(c.totalPerdido  || 0);
      c.ultimoEvento   = c.ultimoEvento || null;  // {tipo, texto, delta, ts}
      c.origenChat     = c.origenChat || c.chat || null;

      // Vencido → remover
      if (t >= c.fin) {
        db.esclavos.splice(i, 1);
        continue;
      }

      // Aún no toca pagar
      if (t < c.nextRewardAt) continue;

      const dueno   = safeUser(db, c.owner);
      const esclavo = safeUser(db, c.slave);
      if (!dueno || !esclavo) {
        db.esclavos.splice(i, 1);
        continue;
      }

      // Calcular recompensa por TICK (escala del rango por hora)
      const { baseMinH, baseMaxH, precio } = resumenPorHora(c.dias);
      const minHora = baseMinH || Math.max(1, Math.floor((c.precio || 1000) / (c.dias * 24 || 24)));
      const maxHora = baseMaxH || Math.max(minHora, Math.floor(1.2 * minHora));

      // Escalar al tamaño del tick
      const minTick = Math.max(1, Math.floor(minHora * scale));
      const maxTick = Math.max(minTick, Math.floor(maxHora * scale));

      let delta = rndInt(minTick, maxTick); // por defecto positivo
      let tipo = "positivo";
      let texto = null;

      // Evento negativo (5%)
      if (Math.random() < CHANCE_NEGATIVO) {
        const minPropTick = 0.02 * scale; // 2%/h → 2% * escala por tick
        const maxPropTick = 0.05 * scale; // 5%/h → 5% * escala por tick
        const perdida = Math.max(1, Math.floor(precio * rnd(minPropTick, maxPropTick)));
        delta = -perdida;
        tipo = "negativo";
        const tpl = TEXTOS_NEGATIVOS[rndInt(0, TEXTOS_NEGATIVOS.length - 1)];
        texto = tpl
          .replace("{owner}", `@${dueno.numero}`)
          .replace("{slave}", `@${esclavo.numero}`)
          .replace("{monto}", moneda(perdida));

        // Preparar notificación agrupada
        if (conn) {
          const key = dueno.numero;
          if (!negativosPorDueno.has(key)) {
            negativosPorDueno.set(key, {
              chat: c.origenChat || `${dueno.numero}@s.whatsapp.net`,
              lines: [],
              mentions: new Set([`${dueno.numero}@s.whatsapp.net`])
            });
          }
          const pack = negativosPorDueno.get(key);
          pack.lines.push(`• ${texto}`);
          pack.mentions.add(`${esclavo.numero}@s.whatsapp.net`);
          // si algún contrato trae origenChat (grupo), úsalo como destino preferido
          if (c.origenChat) pack.chat = c.origenChat;
        }
      }

      // Aplicar al dueño y a los acumulados
      dueno.creditos = Number(dueno.creditos || 0) + delta;
      if (delta >= 0) c.totalGanado += delta;
      else c.totalPerdido += Math.abs(delta);

      // Guardar último evento (útil para .veres si lo quieres mostrar)
      c.ultimoEvento = { tipo, texto, delta, ts: t };

      // Reprogramar próximo tick (alineado a buckets)
      c.nextRewardAt = proximoTick(BASE_TICK_MS);

    } catch (e) {
      console.error("[esclavos_recompensas] Error contrato:", e);
    }
  }

  // Guardar cambios antes de enviar mensajes
  try { fs.writeFileSync(file, JSON.stringify(db, null, 2)); } catch {}

  // Enviar las notificaciones de NEGATIVOS agrupadas por dueño (si hubo)
  if (negativosPorDueno.size && _lastConnRef) {
    for (const [duenoNum, pack] of negativosPorDueno.entries()) {
      const { chat, lines, mentions } = pack;
      if (!lines.length) continue;
      const caption =
        `⚠️ *PERDISTE CREDITOS TU ESCLAVO ISO ALGO MAL*⚠️\n` +
        `👑 Dueño: @${duenoNum}\n` +
        `────────────────────\n` +
        lines.join("\n");
      try {
        await _lastConnRef.sendMessage(chat, {
          text: caption,
          mentions: Array.from(mentions)
        });
      } catch {
        try {
          await _lastConnRef.sendMessage(`${duenoNum}@s.whatsapp.net`, {
            text: caption,
            mentions: Array.from(mentions)
          });
        } catch (e2) {
          console.error("[esclavos_recompensas] No se pudo notificar negativos a:", duenoNum, e2);
        }
      }
    }
  }

  running = false;
}

let _lastConnRef = null;

// Loader
const handler = async (conn) => {
  if (_intervalRef) {
    console.log("[esclavos_recompensas] Intervalo ya activo; no se crea otro.");
    return;
  }
  // guardo la conn para notificaciones
  _lastConnRef = conn;

  // Primera pasada a los 30s para dar tiempo a que cargue todo
  setTimeout(() => procesarRecompensas(conn), 30 * 1000);
  _intervalRef = setInterval(() => procesarRecompensas(conn), INTERVALO_MS);
  console.log("[esclavos_recompensas] Iniciado. Sin pagos al chat; notifica NEGATIVOS (5%) agrupados por dueño.");
};

handler.run = handler;
export default handler;
