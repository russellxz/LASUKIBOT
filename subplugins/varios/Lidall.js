// plugins/mylid.js
const DIGITS = (s = "") => (s || "").replace(/\D/g, "");

/** Busca el LID usando varias rutas posibles */
function findLid(realJid, { conn }) {
  const tryPaths = [
    () => (typeof init !== "undefined") && init?.users?.[realJid]?.lid,
    () => global?.init?.users?.[realJid]?.lid,
    () => conn?.init?.users?.[realJid]?.lid,
    () => conn?.store?.contacts?.[realJid]?.lid,
    () => global?.db?.data?.users?.[realJid]?.lid, // por si lo guardas allí
  ];
  for (const get of tryPaths) {
    try {
      const v = get();
      if (v) return String(v);
    } catch {}
  }
  return null;
}

/** Si viene @lid, intenta hallar su @s.whatsapp.net recorriendo caches */
function findRealFromLid(lidJid, { conn }) {
  const lidDigits = DIGITS(lidJid);
  const buckets = [
    (typeof init !== "undefined") && init?.users,
    global?.init?.users,
    conn?.init?.users,
    conn?.store?.contacts,
  ].filter(Boolean);
  for (const bucket of buckets) {
    try {
      for (const [jid, data] of Object.entries(bucket)) {
        const cand = data?.lid || data?.LID;
        if (cand && DIGITS(String(cand)) === lidDigits) return jid;
      }
    } catch {}
  }
  return null;
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacciona al inicio
  try { await conn.sendMessage(chatId, { react: { text: "🛰️", key: msg.key } }); } catch {}

  // Detectar citado (participante del mensaje citado)
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const citado = ctx?.participant; // puede ser @s.whatsapp.net o @lid

  // 1) Resolver objetivo "visible" (citado o autor)
  let objetivo = citado || (msg.key.participant || msg.key.remoteJid);

  // 2) Resolver JID real del objetivo
  let realJid;
  if (citado) {
    // Si citaste a alguien:
    if (citado.endsWith("@s.whatsapp.net")) {
      realJid = citado; // ya es visible
    } else if (citado.endsWith("@lid")) {
      // Intentar mapear @lid -> real @s.whatsapp.net
      realJid = findRealFromLid(citado, { conn });
      // Si no se pudo mapear, usar el JID del autor para no dejar vacío
      if (!realJid) realJid = msg.key.jid || msg.key.participant || msg.key.remoteJid;
    }
  } else {
    // Sin cita: el real SIEMPRE desde m.key.jid (como indicaste)
    realJid = msg.key.jid || msg.key.participant || msg.key.remoteJid;
  }

  // Asegurar que sea un @s.whatsapp.net
  if (realJid?.endsWith?.("@g.us")) {
    // Si por alguna razón cayó un grupo, intenta el jid del autor
    realJid = msg.key.jid || msg.key.participant || "";
  }

  // Normalizar
  if (realJid && !realJid.endsWith("@s.whatsapp.net")) {
    const only = DIGITS(realJid);
    if (only) realJid = `${only}@s.whatsapp.net`; // ← backticks OK
  }

  // 3) Resolver LID del objetivo
  let lidJid;
  if (objetivo?.endsWith?.("@lid")) {
    // Si el objetivo ya viene en LID, úsalo directo
    lidJid = objetivo;
  } else {
    // Grupo NO-LID o chat normal: buscar en caches
    const keyForLid = citado?.endsWith?.("@s.whatsapp.net") ? citado : realJid;
    const found = findLid(keyForLid, { conn });
    if (found) {
      lidJid = /@lid$/.test(found) ? found : `${DIGITS(found)}@lid`; // ← backticks OK
    }
  }

  // Datos para mostrar
  const realNum = realJid ? DIGITS(realJid) : null;
  const tipoObj = objetivo?.endsWith?.("@lid")
    ? "LID oculto (@lid)"
    : "Número visible (@s.whatsapp.net)";

  const texto = `
📡 *Info de usuario*
👤 *Objetivo:* ${objetivo || "desconocido"}
🔐 *Tipo actual:* ${tipoObj}
📱 *Número real:* ${realNum ? `+${realNum}` : "No disponible"}
🧬 *LID:* ${lidJid ? `\`${lidJid}\`` : "No disponible"}
`.trim(); // ← todo el bloque en backticks

  await conn.sendMessage(chatId, { text: texto }, { quoted: msg });

  // Confirmación
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

handler.command = ["mylid", "lid", "mlid", "jidreal"];
export default handler;
