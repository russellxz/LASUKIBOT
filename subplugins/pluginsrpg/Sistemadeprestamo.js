// plugins/checkPrestamosBanco.js
// Vence préstamos y liquida la deuda:
// 1) Confisca créditos (creditos + guardado) → los pone en 0 y descuenta de la deuda
// 2) Confisca VARIOS personajes (de mayor a menor precio)
// 3) Confisca VARIAS mascotas (de mayor a menor precio)
// Si cubre la deuda → préstamo eliminado. Si el usuario queda sin nada → deuda cancelada.

import fs from 'fs';
import path from 'path';

const INTERVALO_MS = 15000; // 15s (test)
const COOLDOWN_MS = 5000;   // evita doble proceso del mismo préstamo

function num(n, d = 0) { return Number.isFinite(Number(n)) ? Number(n) : d; }
function toPrice(x, fallback = 1000) {
  const v = Number(x?.precio);
  if (Number.isFinite(v) && v > 0) return v;
  const c = Number(x?.costo); if (Number.isFinite(c) && c > 0) return c;
  const val = Number(x?.valor); if (Number.isFinite(val) && val > 0) return val;
  return fallback;
}
function ordenarPorPrecioDesc(arr) {
  return (arr || []).slice().sort((a, b) => toPrice(b) - toPrice(a));
}

const runChecker = (conn) => {
  setInterval(async () => {
    const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
    if (!fs.existsSync(sukirpgPath)) return;

    try {
      const db = JSON.parse(fs.readFileSync(sukirpgPath, "utf-8")) || {};
      db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
      db.banco = db.banco || null;
      if (!db.banco) return;

      const plazoMs =
        (db.banco.plazo && typeof db.banco.plazo.ms === "number" && db.banco.plazo.ms > 0)
          ? db.banco.plazo.ms
          : (typeof db.banco.tiempoLimite === "number" ? db.banco.tiempoLimite : 0);
      if (!plazoMs) return;

      db.banco.prestamos = Array.isArray(db.banco.prestamos) ? db.banco.prestamos : [];
      db.banco.tiendaPersonajesBanco = Array.isArray(db.banco.tiendaPersonajesBanco)
        ? db.banco.tiendaPersonajesBanco : [];
      db.banco.tiendaMascotasBanco = Array.isArray(db.banco.tiendaMascotasBanco)
        ? db.banco.tiendaMascotasBanco : [];
      db.banco.montoTotal = num(db.banco.montoTotal, 0);

      const ahora = Date.now();
      let huboCambios = false;

      for (let i = db.banco.prestamos.length - 1; i >= 0; i--) {
        const prestamo = db.banco.prestamos[i];
        try {
          prestamo.numero = String(prestamo.numero || "");
          prestamo.grupo = prestamo.grupo || `${prestamo.numero}@s.whatsapp.net`;
          prestamo.fechaInicio = num(prestamo.fechaInicio, ahora);
          prestamo.fechaLimite = num(prestamo.fechaLimite, prestamo.fechaInicio + plazoMs);

          if (prestamo.pendiente == null) {
            const base = num(prestamo.cantidadSolicitada, num(prestamo.cantidad, 0));
            prestamo.pendiente = Math.max(0, Math.ceil(base * 1.20) - num(prestamo.pagado, 0));
          } else {
            prestamo.pendiente = Math.max(0, num(prestamo.pendiente, 0));
          }

          if (prestamo._cooldown && ahora < prestamo._cooldown) continue;
          if (ahora <= prestamo.fechaLimite) continue;

          const usuario = db.usuarios.find(u => String(u.numero) === prestamo.numero);
          if (!usuario) {
            prestamo.fechaInicio = ahora;
            prestamo.fechaLimite = ahora + plazoMs;
            prestamo._cooldown = ahora + COOLDOWN_MS;
            huboCambios = true;
            continue;
          }

          const mentionJid = `${usuario.numero}@s.whatsapp.net`;
          const chatDestino = prestamo.grupo;
          let pendiente = Math.max(0, num(prestamo.pendiente, 0));

          if (pendiente <= 0) {
            db.banco.prestamos.splice(i, 1);
            huboCambios = true;
            continue;
          }

          // ===== 1) CONFISCAR CRÉDITOS (disponible y guardado) =====
          let confCred_disponible = Math.max(0, num(usuario.creditos, 0));
          let confCred_guardado  = Math.max(0, num(usuario.guardado, 0));
          let confCred_total = 0;

          if (pendiente > 0 && (confCred_disponible > 0 || confCred_guardado > 0)) {
            // Tomamos primero del saldo disponible
            const tomarDisp = Math.min(pendiente, confCred_disponible);
            usuario.creditos = confCred_disponible - tomarDisp; // baja a 0 si alcanzó
            pendiente -= tomarDisp;
            confCred_total += tomarDisp;

            // Luego del guardado
            if (pendiente > 0 && confCred_guardado > 0) {
              const tomarGuard = Math.min(pendiente, confCred_guardado);
              usuario.guardado = confCred_guardado - tomarGuard; // baja a 0 si alcanzó
              pendiente -= tomarGuard;
              confCred_total += tomarGuard;
            }

            // El banco recupera capital equivalente a lo confiscado
            db.banco.montoTotal = num(db.banco.montoTotal, 0) + confCred_total;
            huboCambios = true;
          }

          // ===== 2) PERSONAJES (si aún queda deuda) =====
          let confiscadosPj = [];
          if (Array.isArray(usuario.personajes) && usuario.personajes.length > 0 && pendiente > 0) {
            const orden = ordenarPorPrecioDesc(usuario.personajes);
            for (const pj of orden) {
              if (pendiente <= 0) break;
              const valor = toPrice(pj, 1000);
              const idx = usuario.personajes.indexOf(pj);
              if (idx !== -1) usuario.personajes.splice(idx, 1);

              db.banco.tiendaPersonajesBanco.push({
                nombre: String(pj?.nombre || "Personaje"),
                imagen: String(pj?.imagen || ""),
                precio_original: valor,
                precio_venta: valor,
                nivel: num(pj?.nivel, 1),
                habilidades: Array.isArray(pj?.habilidades) ? pj.habilidades : [],
                origen: "embargo",
                decomisadoDe: {
                  numero: usuario.numero,
                  nombre: usuario.nombre,
                  apellido: usuario.apellido
                },
                fechaEmbargo: ahora
              });

              db.banco.montoTotal = num(db.banco.montoTotal, 0) + valor;
              pendiente -= valor;
              confiscadosPj.push({ nombre: pj?.nombre || "Personaje", valor });
              huboCambios = true;
            }
          }

          // ===== 3) MASCOTAS (si aún queda deuda) =====
          let confiscadasMs = [];
          if (Array.isArray(usuario.mascotas) && usuario.mascotas.length > 0 && pendiente > 0) {
            const ordenMs = ordenarPorPrecioDesc(usuario.mascotas);
            for (const ms of ordenMs) {
              if (pendiente <= 0) break;
              const valor = toPrice(ms, 800);
              const idx = usuario.mascotas.indexOf(ms);
              if (idx !== -1) usuario.mascotas.splice(idx, 1);

              db.banco.tiendaMascotasBanco.push({
                nombre: String(ms?.nombre || "Mascota"),
                imagen: String(ms?.imagen || "https://cdn.russellxz.click/25e8051c.jpeg"),
                precio_original: valor,
                precio_venta: valor,
                nivel: num(ms?.nivel, 1),
                habilidades: Array.isArray(ms?.habilidades) ? ms.habilidades : [],
                origen: "embargo",
                decomisadoDe: {
                  numero: usuario.numero,
                  nombre: usuario.nombre,
                  apellido: usuario.apellido
                },
                fechaEmbargo: ahora
              });

              db.banco.montoTotal = num(db.banco.montoTotal, 0) + valor;
              pendiente -= valor;
              confiscadasMs.push({ nombre: ms?.nombre || "Mascota", valor });
              huboCambios = true;
            }
          }

          // ===== MENSAJE RESUMEN =====
          let captionResumen = `⚠️ *Incumplimiento de préstamo*\n` +
            `👤 Usuario: ${usuario.nombre} ${usuario.apellido} (@${usuario.numero})\n` +
            `🕒 Vencido el: *${new Date(prestamo.fechaLimite).toLocaleString()}*\n\n`;

          if (confCred_total > 0) {
            captionResumen += `💸 *Créditos confiscados:* ${confCred_total} (disponible + guardado)\n`;
          }

          // Resultado final
          if (pendiente <= 0) {
            captionResumen += `\n✅ *Deuda cubierta con embargos.* El préstamo ha sido *liquidado*.\n`;
            if (confiscadosPj.length) {
              captionResumen += `\n🧾 *Personajes embargados:*\n`;
              for (const it of confiscadosPj) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
            }
            if (confiscadasMs.length) {
              captionResumen += `\n🐾 *Mascotas embargadas:*\n`;
              for (const it of confiscadasMs) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
            }
            captionResumen += `\n🏦 Los ítems fueron añadidos a la *Tienda del Banco*.\n`;

            db.banco.prestamos.splice(i, 1);
            huboCambios = true;

            await conn.sendMessage(chatDestino, {
              text: captionResumen + `\n@${usuario.numero}`,
              mentions: [mentionJid]
            });
            continue;
          }

          const sinPj = !Array.isArray(usuario.personajes) || usuario.personajes.length === 0;
          const sinMs = !Array.isArray(usuario.mascotas) || usuario.mascotas.length === 0;
          if (sinPj && sinMs) {
            captionResumen += `\n❎ *El usuario quedó sin personajes ni mascotas.*\n` +
                              `🧮 Deuda *restante cancelada*.\n` +
                              `El préstamo ha sido *eliminado* del sistema.\n`;
            if (confiscadosPj.length) {
              captionResumen += `\n🧾 *Personajes embargados:*\n`;
              for (const it of confiscadosPj) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
            }
            if (confiscadasMs.length) {
              captionResumen += `\n🐾 *Mascotas embargadas:*\n`;
              for (const it of confiscadasMs) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
            }
            captionResumen += `\n🏦 Ítems añadidos a la *Tienda del Banco*.\n`;

            db.banco.prestamos.splice(i, 1);
            huboCambios = true;

            await conn.sendMessage(chatDestino, {
              text: captionResumen + `\n@${usuario.numero}`,
              mentions: [mentionJid]
            });
            continue;
          }

          // Reprogramar plazo si aún queda deuda y el usuario todavía tiene algo
          prestamo.pendiente = pendiente;
          prestamo.fechaInicio = ahora;
          prestamo.fechaLimite = ahora + plazoMs;
          prestamo._cooldown = ahora + COOLDOWN_MS;
          huboCambios = true;

          captionResumen += `\n🧮 *Aún queda deuda pendiente:* ${pendiente} créditos.\n` +
                            `⏳ Se otorgó un *nuevo plazo* para el pago.\n`;
          if (confiscadosPj.length) {
            captionResumen += `\n🧾 *Personajes embargados este ciclo:*\n`;
            for (const it of confiscadosPj) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
          }
          if (confiscadasMs.length) {
            captionResumen += `\n🐾 *Mascotas embargadas este ciclo:*\n`;
            for (const it of confiscadasMs) captionResumen += `• ${it.nombre} — ${it.valor} créditos\n`;
          }
          captionResumen += `\n🏦 Ítems añadidos a la *Tienda del Banco*.\n`;

          await conn.sendMessage(chatDestino, {
            text: captionResumen + `\n@${usuario.numero}`,
            mentions: [mentionJid]
          });
        } catch (inner) {
          console.error("❌ Error procesando préstamo:", inner);
        }
      }

      if (huboCambios) {
        fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));
      }
    } catch (err) {
      console.error("❌ Error en checkPrestamosBanco:", err);
    }
  }, INTERVALO_MS);
};

const handler = {};
handler.run = runChecker;
export default handler;
