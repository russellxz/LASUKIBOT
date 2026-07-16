// plugins/lidsu.js
// Muestra LID y REAL del citado (o del autor si no hay cita)

const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

/** Normaliza: si id es @lid y en el wrapper viene .jid (real), usa ese real para 'id' */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid)
        ? v.jid
        : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch (e) {
    console.error("[lidsu] lidParser error:", e);
    return participants || [];
  }
}

/** Obtiene el posible JID citado desde varias rutas */
function getQuotedKey(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const q = msg.quoted;
  return (
    q?.key?.participant ||
    q?.key?.jid ||
    (typeof ctx?.participant === "string" ? ctx.participant : null) ||
    null
  );
}

/** Resuelve el par {realJid, lidJid} a partir de cualquier JID (real o lid) */
async function resolvePair(conn, chatId, anyJid) {
  let realJid = null, lidJid = null;

  const meta = await conn.groupMetadata(chatId);
  const raw  = Array.isArray(meta?.participants) ? meta.participants : [];
  const norm = lidParser(raw);

  // Caso 1: vino como real
  if (typeof anyJid === "string" && anyJid.endsWith("@s.whatsapp.net")) {
    realJid = anyJid;
    // Buscar su contraparte LID (si existe)
    for (let i = 0; i < raw.length; i++) {
      const n = norm[i]?.id;
      const r = raw[i]?.id;
      if (n === realJid && typeof r === "string" && r.endsWith("@lid")) {
        lidJid = r;
        break;
      }
    }
  }

  // Caso 2: vino como LID
  if (!realJid && typeof anyJid === "string" && anyJid.endsWith("@lid")) {
    lidJid = anyJid;
    // 2.a) Si el wrapper trae .jid, úsalo
    const idx = raw.findIndex(p => p?.id === anyJid);
    if (idx >= 0) {
      const wrapper = raw[idx];
      if (typeof wrapper?.jid === "string" && wrapper.jid.endsWith("@s.whatsapp.net")) {
        realJid = wrapper.jid;
      } else if (typeof norm[idx]?.id === "string" && norm[idx].id.endsWith("@s.whatsapp.net")) {
        realJid = norm[idx].id;
      }
    }
    // 2.b) Fallback: busca por coincidencia entre raw/norm
    if (!realJid) {
      const hit = norm.find((n, i) =>
        raw[i]?.id === anyJid &&
        typeof n?.id === "string" &&
        n.id.endsWith("@s.whatsapp.net")
      );
      if (hit) realJid = hit.id;
    }
  }

  return { realJid, lidJid };
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, { text: "❌ Usa este comando en un *grupo*." }, { quoted: msg });
  }

  try { await conn.sendMessage(chatId, { react: { text: "🔎", key: msg.key } }); } catch {}

  // Objetivo: citado → mención → autor
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const quotedKey = getQuotedKey(msg);
  const targetKey = quotedKey || mentioned[0] || msg.key.participant || msg.key.jid || msg.key.remoteJid;

  if (!targetKey) {
    return conn.sendMessage(chatId, { text: "❌ No pude identificar al usuario objetivo." }, { quoted: msg });
  }

  try {
    const { realJid, lidJid } = await resolvePair(conn, chatId, targetKey);

    // Si no hay real, no podemos mostrar número real
    if (!realJid) {
      return conn.sendMessage(chatId, { text: "❌ No pude resolver el *JID real* del usuario." }, { quoted: msg });
    }

    const numeroReal = DIGITS(realJid);
    const estado = lidJid ? "Con LID (número oculto)" : "Sin LID (número visible)";

    const texto =
`📡 *Datos del usuario*
• Estado: ${estado}
• Número real: +${numeroReal}
• JID real: \`${realJid}\`
• JID LID: \`${lidJid || "—"}\``;

    const mentionId = realJid; // menciona al real
    await conn.sendMessage(chatId, { text: texto, mentions: [mentionId] }, { quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  } catch (e) {
    console.error("[lidsu] error:", e);
    await conn.sendMessage(chatId, { text: "❌ Ocurrió un error al resolver los datos." }, { quoted: msg });
  }
};

handler.command = ["mylid"];
export default handler;
