import fs from 'fs';
import path from 'path';

const pendingDelete = {};

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = sender.replace(/[^0-9]/g, "");

  const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(sukirpgPath)) {
    return conn.sendMessage(chatId, {
      text: "❌ La base de datos RPG aún no existe.",
    }, { quoted: msg });
  }

  let db = JSON.parse(fs.readFileSync(sukirpgPath));
  db.usuarios = db.usuarios || [];
  db.personajes = db.personajes || [];
  db.banco = db.banco || null;

  const usuario = db.usuarios.find(u => u.numero === numero);
  if (!usuario) {
    return conn.sendMessage(chatId, {
      text: "❌ No estás registrado en el RPG. Usa `.rpg` para registrarte.",
    }, { quoted: msg });
  }

  // 🚫 NUEVO: bloquear si tiene deuda activa en el banco
  const tieneDeudaActiva = Array.isArray(db?.banco?.prestamos) && db.banco.prestamos.some(p => {
    if (String(p.numero) !== numero || p.estado !== "activo") return false;
    const prestadoBase = Number(p.cantidadSolicitada ?? p.cantidad ?? 0);
    const totalAPagar = Number.isFinite(p.totalAPagar) ? Number(p.totalAPagar) : Math.ceil(prestadoBase * 1.20);
    const pagado = Number(p.pagado || 0);
    const pendiente = Number.isFinite(p.pendiente) ? Number(p.pendiente) : Math.max(totalAPagar - pagado, 0);
    return pendiente > 0;
  });

  if (tieneDeudaActiva) {
    return conn.sendMessage(chatId, {
      text: "🏦 No puedes eliminar tu RPG porque tienes una *deuda activa* en el banco.\nPágala con *.pagarall* o espera a que el sistema la liquide.",
    }, { quoted: msg });
  }

  const confirmMsg = await conn.sendMessage(chatId, {
    text: `⚠️ ¿Estás segur@ que deseas eliminar tu cuenta RPG?\n\n📝 *Responde este mensaje escribiendo:*\n*si quiero*`,
  }, { quoted: msg });

  const requestId = confirmMsg.key.id;

  pendingDelete[requestId] = {
    numero,
    chatId,
    autor: sender,
    timer: setTimeout(() => {
      delete pendingDelete[requestId];
      conn.sendMessage(chatId, {
        text: "⏳ La solicitud de eliminación RPG ha expirado por inactividad.",
      }, { quoted: confirmMsg });
    }, 2 * 60 * 1000) // 2 minutos
  };

  if (!conn._delrpgListener) {
    conn._delrpgListener = true;
    conn.ev.on("messages.upsert", async ev => {
      for (const m of ev.messages) {
        if (!m.message || m.key.fromMe) continue;

        const context = m.message?.extendedTextMessage?.contextInfo;
        const citado = context?.stanzaId;
        const texto = (
          m.message?.conversation?.toLowerCase() ||
          m.message?.extendedTextMessage?.text?.toLowerCase() ||
          ""
        ).trim();

        const job = pendingDelete[citado];
        if (!job || texto !== "si quiero") continue;

        const quienContesta = m.key.participant || m.key.remoteJid;
        if (quienContesta !== job.autor) {
          await conn.sendMessage(job.chatId, {
            text: "🚫 Solo quien inició la solicitud puede confirmarla.",
          }, { quoted: m });
          return;
        }

        // Releer DB
        const sukirpgPath = path.join(process.cwd(), "sukirpg.json");
        let db = JSON.parse(fs.readFileSync(sukirpgPath));
        db.usuarios = db.usuarios || [];
        db.personajes = db.personajes || [];
        db.banco = db.banco || null;

        // 🚫 NUEVO: volver a verificar deuda por seguridad
        const deudaActivaAhora = Array.isArray(db?.banco?.prestamos) && db.banco.prestamos.some(p => {
          if (String(p.numero) !== job.numero || p.estado !== "activo") return false;
          const prestadoBase = Number(p.cantidadSolicitada ?? p.cantidad ?? 0);
          const totalAPagar = Number.isFinite(p.totalAPagar) ? Number(p.totalAPagar) : Math.ceil(prestadoBase * 1.20);
          const pagado = Number(p.pagado || 0);
          const pendiente = Number.isFinite(p.pendiente) ? Number(p.pendiente) : Math.max(totalAPagar - pagado, 0);
          return pendiente > 0;
        });

        if (deudaActivaAhora) {
          clearTimeout(job.timer);
          delete pendingDelete[citado];
          await conn.sendMessage(job.chatId, {
            text: "🏦 No puedes eliminar tu RPG porque ahora tienes una *deuda activa* en el banco.\nPágala con *.pagarall* o espera a que el sistema la liquide.",
          }, { quoted: m });
          return;
        }

        const idx = db.usuarios.findIndex(u => u.numero === job.numero);
        if (idx === -1) {
          await conn.sendMessage(job.chatId, {
            text: "❌ No se encontró tu perfil RPG.",
          }, { quoted: m });
          delete pendingDelete[citado];
          return;
        }

        const user = db.usuarios[idx];

        if (user.personajes?.length) {
          for (const personaje of user.personajes) {
            db.personajes.push({
              nombre: personaje.nombre,
              imagen: personaje.imagen,
              precio: personaje.precio,
              nivel: personaje.nivel,
              habilidades: personaje.habilidades
            });
          }
        }

        db.usuarios.splice(idx, 1);
        clearTimeout(job.timer);
        delete pendingDelete[citado];

        fs.writeFileSync(sukirpgPath, JSON.stringify(db, null, 2));

        await conn.sendMessage(job.chatId, {
          text: `✅ Tu cuenta RPG ha sido eliminada con éxito.\n\n🛒 Tus personajes fueron devueltos a la tienda.`,
        }, { quoted: m });

        await conn.sendMessage(job.chatId, {
          react: { text: "🗑️", key: m.key }
        });
      }
    });
  }
};

handler.command = ["delrpg"];

export default handler;
