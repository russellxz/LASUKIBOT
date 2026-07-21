// subplugins/setprefix.js — Cada subbot puede cambiar su propio prefijo
// Los prefijos se guardan en subbots/data/<numero>/config.json (independiente por subbot)

// Cuenta grafemas (un emoji, aunque tenga varios code points, cuenta como 1)
function contarGrafemas(str) {
  try {
    const seg = new Intl.Segmenter("es", { granularity: "grapheme" });
    return [...seg.segment(str)].length;
  } catch {
    return [...str].length; // fallback por code points
  }
}

// Un prefijo válido es UN solo carácter/símbolo/emoji, sin espacios
function prefijoValido(p) {
  return typeof p === "string" && p.length > 0 && !/\s/.test(p) && contarGrafemas(p) === 1;
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const fromMe = msg.key.fromMe;

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }).catch(() => {});

  // 🚫 Solo el mismo subbot puede cambiar su prefijo
  if (!fromMe) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede cambiar el prefijo."
    }, { quoted: msg });
  }

  const p = conn?.subPrefixes?.[0] || ".";

  if (!args[0]) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `✳️ Uso correcto:\n${p}setprefix [ "." , "🐱", "#" ]\n${p}setprefix 🤖\n\n📌 Prefijos actuales: ${(conn.subPrefixes || []).join("  ")}`
    }, { quoted: msg });
  }

  let nuevosPrefijos;

  try {
    if (args.join(" ").trim().startsWith("[")) {
      nuevosPrefijos = JSON.parse(args.join(" ").trim());
      if (!Array.isArray(nuevosPrefijos) || !nuevosPrefijos.length) throw new Error();
    } else {
      // Sin corchetes: solo se acepta UN prefijo (un carácter/emoji).
      // Se toma solo el primer argumento; si escribió varios (ej "setprefix x PENE")
      // sobra texto y se rechaza más abajo por longitud.
      nuevosPrefijos = [args.join(" ").trim()];
    }
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `⚠️ Prefijo inválido.\nEjemplos válidos:\n${p}setprefix [ "." , "#" , "💀" ]\n${p}setprefix 🤖`
    }, { quoted: msg });
  }

  // Cada prefijo debe ser UN solo carácter/símbolo/emoji (nada de palabras)
  const invalidos = nuevosPrefijos.filter(x => !prefijoValido(x));

  if (invalidos.length) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `⚠️ *Cada prefijo debe ser UN solo carácter o emoji.*
No se permiten palabras ni varios caracteres.

${invalidos.length ? `❌ No válido(s): ${invalidos.map(x => `"${x}"`).join("  ")}\n\n` : ""}✅ Ejemplos válidos:
${p}setprefix .
${p}setprefix 🤖
${p}setprefix [ "." , "#" , "/" ]`
    }, { quoted: msg });
  }

  // Quitar duplicados manteniendo el orden
  nuevosPrefijos = [...new Set(nuevosPrefijos)];

  // Guardar en el config.json propio del subbot
  const cfg = conn.readSubData("config.json", {});
  cfg.prefixes = nuevosPrefijos;
  conn.writeSubData("config.json", cfg);
  conn.subPrefixes = nuevosPrefijos;

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});

  return conn.sendMessage(chatId, {
    text: `✅ Prefijo(s) de tu subbot actualizado(s):\n${nuevosPrefijos.map(x => `➤ ${x}`).join("\n")}`
  }, { quoted: msg });
};

handler.command = ["setprefix"];
export default handler;
