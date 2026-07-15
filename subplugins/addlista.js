// subplugins/addlista.js — Agrega/quita números para que el subbot les responda
// en PRIVADO. Guardado en subbots/data/<numero>/lista.json
// 🚫 Solo lo puede usar el mismo subbot (fromMe)
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const fromMe = msg.key.fromMe;
  const p = conn?.subPrefixes?.[0] || ".";

  if (!fromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede usar este comando."
    }, { quoted: msg });
  }

  // También acepta mención o respuesta a un mensaje
  let numero = "";
  const mencion = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const citado = msg.message?.extendedTextMessage?.contextInfo?.participant;

  if (mencion) numero = DIGITS(mencion);
  else if ((args || []).length) numero = DIGITS(args.join(" "));
  else if (citado) numero = DIGITS(citado);

  if (!numero || numero.length < 7) {
    return conn.sendMessage(chatId, {
      text: `✳️ Uso correcto:\n*${p}${command} +507 6123-4567*\nTambién puedes mencionar al usuario o responder a su mensaje.`
    }, { quoted: msg });
  }

  let lista = conn.readSubData("lista.json", []);
  if (!Array.isArray(lista)) lista = [];
  lista = lista.map(DIGITS).filter(Boolean);

  if (command === "addlista") {
    if (lista.includes(numero)) {
      return conn.sendMessage(chatId, {
        text: `ℹ️ El número *+${numero}* ya está en tu lista de privados.`
      }, { quoted: msg });
    }

    lista.push(numero);
    conn.writeSubData("lista.json", lista);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: `✅ Número *+${numero}* agregado.\n🤖 El subbot ahora le responderá en *privado*.\n\n✖️ Para quitarlo: *${p}dellista +${numero}*`
    }, { quoted: msg });
  }

  // dellista
  if (!lista.includes(numero)) {
    return conn.sendMessage(chatId, {
      text: `ℹ️ El número *+${numero}* no está en tu lista.`
    }, { quoted: msg });
  }

  lista = lista.filter(n => n !== numero);
  conn.writeSubData("lista.json", lista);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  return conn.sendMessage(chatId, {
    text: `✅ Número *+${numero}* eliminado de tu lista de privados.`
  }, { quoted: msg });
};

handler.command = ["addlista", "dellista"];
export default handler;
