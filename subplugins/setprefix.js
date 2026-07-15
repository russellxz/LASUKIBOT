// subplugins/setprefix.js — Cada subbot puede cambiar su propio prefijo
// Los prefijos se guardan en subbots/data/<numero>/config.json (independiente por subbot)
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
    if (args.join(" ").startsWith("[")) {
      nuevosPrefijos = JSON.parse(args.join(" ").trim());
      if (!Array.isArray(nuevosPrefijos) || !nuevosPrefijos.length || nuevosPrefijos.some(x => typeof x !== "string" || x.length === 0)) throw new Error();
    } else {
      nuevosPrefijos = [args.join(" ")]; // acepta emojis largos o combinaciones
    }
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `⚠️ Prefijo inválido.\nEjemplos válidos:\n${p}setprefix [ "." , "#" , "💀" ]\n${p}setprefix 🤖`
    }, { quoted: msg });
  }

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
