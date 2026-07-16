// plugins/delclan.js
// Comando: .delclan
// Borra el clan del usuario (solo si es LÍDER) tras confirmación respondiendo "si" al mensaje.
// No permite borrar el clan supremo. Responde siempre citando y caduca en 2 minutos.

import fs from 'fs';
import path from 'path';

const pendingDelClan = {};

function loadDB(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; }
function saveDB(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2)); }

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");

  // reacción inicial
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  const file = path.join(process.cwd(), "sukirpg.json");
  if (!fs.existsSync(file)) {
    return conn.sendMessage(chatId, { text: "❌ La base de datos RPG aún no existe." }, { quoted: msg });
  }

  let db = loadDB(file);
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.clanes   = Array.isArray(db.clanes)   ? db.clanes   : [];

  const user = db.usuarios.find(u => String(u.numero) === String(numero));
  if (!user) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "❌ No estás registrado en el RPG." }, { quoted: msg });
  }

  // Clan donde el usuario es líder
  const clan = db.clanes.find(c =>
    c.lider && c.lider.numero && String(c.lider.numero) === String(numero)
  );

  if (!clan) {
    await conn.sendMessage(chatId, { react: { text: "ℹ️", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "📭 No eres líder de ningún clan. Solo el líder puede borrarlo."
    }, { quoted: msg });
  }

  // No permitir borrar el clan supremo
  if (clan.esSupremo) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 No puedes borrar el *clan supremo*."
    }, { quoted: msg });
  }

  // Mensaje de confirmación (responder con "si")
  const confirmMsg = await conn.sendMessage(chatId, {
    text:
`⚠️ ¿Seguro que deseas *ELIMINAR* el clan *${clan.nombre}*?
Esta acción es permanente y eliminará todos sus miembros del clan.

📝 *Responde a ESTE mensaje escribiendo:*
*si*`,
  }, { quoted: msg });

  const requestId = confirmMsg.key.id;

  // Guardar pending
  pendingDelClan[requestId] = {
    chatId,
    clanId: clan.id,
    autor: sender,
    numero,
    timer: setTimeout(async () => {
      delete pendingDelClan[requestId];
      await conn.sendMessage(chatId, {
        text: "⏳ La solicitud de eliminación del clan ha expirado por inactividad."
      }, { quoted: confirmMsg });
    }, 2 * 60 * 1000) // 2 minutos
  };

  // Registrar listener una sola vez
  if (!conn._delclanListener) {
    conn._delclanListener = true;

    conn.ev.on("messages.upsert", async ev => {
      for (const m of ev.messages) {
        try {
          if (!m.message || m.key.fromMe) continue;

          // Texto normal o extendedText
          const texto = (
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            ""
          ).trim().toLowerCase();

          // Debe ser respuesta a un mensaje nuestro
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          if (!citado) continue;

          const job = pendingDelClan[citado];
          if (!job) continue; // no es una confirmación pendiente

          // Validar que conteste el mismo autor
          const quienContesta = m.key.participant || m.key.remoteJid;
          if (quienContesta !== job.autor) {
            await conn.sendMessage(job.chatId, {
              text: "🚫 Solo quien inició la solicitud puede confirmarla."
            }, { quoted: m });
            continue;
          }

          if (texto !== "si") {
            // Ignorar otros textos (no cancelamos la pending por si se equivoca)
            continue;
          }

          // Releer DB
          const file2 = path.join(process.cwd(), "sukirpg.json");
          let db2 = loadDB(file2);
          db2.usuarios = Array.isArray(db2.usuarios) ? db2.usuarios : [];
          db2.clanes   = Array.isArray(db2.clanes)   ? db2.clanes   : [];

          // Buscar el clan por id
          const idx = db2.clanes.findIndex(c => c.id === job.clanId);
          if (idx === -1) {
            clearTimeout(job.timer);
            delete pendingDelClan[citado];
            await conn.sendMessage(job.chatId, {
              text: "❌ No se encontró el clan (ya pudo haber sido eliminado)."
            }, { quoted: m });
            continue;
          }

          const clanObj = db2.clanes[idx];

          // Seguridad: verificar que sigue siendo líder y que no es supremo
          if (clanObj.esSupremo) {
            clearTimeout(job.timer);
            delete pendingDelClan[citado];
            await conn.sendMessage(job.chatId, {
              text: "🚫 No puedes borrar el *clan supremo*."
            }, { quoted: m });
            continue;
          }

          if (!(clanObj.lider && String(clanObj.lider.numero) === String(job.numero))) {
            clearTimeout(job.timer);
            delete pendingDelClan[citado];
            await conn.sendMessage(job.chatId, {
              text: "🚫 Ya no eres el líder de este clan; no puedes borrarlo."
            }, { quoted: m });
            continue;
          }

          // Borrar el clan
          db2.clanes.splice(idx, 1);
          saveDB(file2, db2);

          // Limpiar pending
          clearTimeout(job.timer);
          delete pendingDelClan[citado];

          await conn.sendMessage(job.chatId, {
            text: `✅ El clan *${clanObj.nombre}* ha sido eliminado correctamente.`
          }, { quoted: m });

          await conn.sendMessage(job.chatId, { react: { text: "🗑️", key: m.key } });
        } catch (e) {
          // silencioso para no romper el flujo
        }
      }
    });
  }

  // reacción final al comando
  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["delclan"];
export default handler;
