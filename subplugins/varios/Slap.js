import fs from 'fs';
import path from 'path';

const gifUrls = [
  "https://cdn.russellxz.click/f66ec014.mp4",
  "https://cdn.russellxz.click/d0df072f.mp4",
  "https://cdn.russellxz.click/b0a1bc6a.mp4",
  "https://cdn.russellxz.click/cb323398.mp4",
  "https://cdn.russellxz.click/59bc9653.mp4"
];

const textos = [
  "👋 *@1 le dio una tremenda bofetada a @2* 💥",
  "😤 *@1 no se aguantó y cacheteó a @2* 🤚",
  "🥴 *@1 le soltó una cachetada a @2 sin piedad* 😬",
  "😡 *@1 se enojó y ¡pum! cachetada a @2* ⚡",
  "🔥 *@1 dejó ardiendo la cara de @2* 🥵",
  "💢 *@1 reaccionó con una cachetada para @2* 🤕",
  "🥊 *@1 aplicó tremenda mano limpia a @2* 🤛",
  "🧨 *@1 explotó y le dio una a @2 que sonó hasta Marte* 🚀"
];

const SLAP_PATH = path.resolve("slap_data.json");
const SLAP_COOLDOWN = 2 * 60 * 1000; // 2 minutos

const handler = async (msg, { conn, args }) => {
  const isGroup = msg.key.remoteJid.endsWith("@g.us");
  const chatId = msg.key.remoteJid;

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "⚠️ Este comando solo se puede usar en grupos."
    }, { quoted: msg });
  }

  // Reacción inicial
  await conn.sendMessage(chatId, {
    react: { text: "🤜", key: msg.key }
  });

  const senderID = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderID.split("@")[0];

  // Obtener destinatario
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  let targetID;

  if (ctx?.participant) {
    targetID = ctx.participant;
  } else if (args[0]) {
    const raw = args[0].replace(/[^0-9]/g, "");
    targetID = raw ? `${raw}@s.whatsapp.net` : null;
  }

  if (!targetID) {
    return conn.sendMessage(chatId, {
      text: "💡 Responde al mensaje o menciona a alguien para cachetearlo 🤜"
    }, { quoted: msg });
  }

  if (targetID === senderID) {
    return conn.sendMessage(chatId, {
      text: "😅 No puedes cachetearte a ti mismo..."
    }, { quoted: msg });
  }

  let data = fs.existsSync(SLAP_PATH) ? JSON.parse(fs.readFileSync(SLAP_PATH)) : {};
  if (!data[chatId]) data[chatId] = { slapDados: {}, slapRecibidos: {} };

  const ahora = Date.now();
  const last = data[chatId].slapDados[senderNum]?.usuarios?.[targetID]?.last || 0;

  if (ahora - last < SLAP_COOLDOWN) {
    const mins = Math.ceil((SLAP_COOLDOWN - (ahora - last)) / 60000);
    return conn.sendMessage(chatId, {
      text: `⏳ Debes esperar *${mins} minuto(s)* para volver a cachetear a ese usuario.`,
      mentions: [targetID]
    }, { quoted: msg });
  }

  // Actualizar slap dados
  if (!data[chatId].slapDados[senderNum]) {
    data[chatId].slapDados[senderNum] = { total: 0, usuarios: {} };
  }
  if (!data[chatId].slapDados[senderNum].usuarios[targetID]) {
    data[chatId].slapDados[senderNum].usuarios[targetID] = { count: 0, last: 0 };
  }
  data[chatId].slapDados[senderNum].total += 1;
  data[chatId].slapDados[senderNum].usuarios[targetID].count += 1;
  data[chatId].slapDados[senderNum].usuarios[targetID].last = ahora;

  // Actualizar slap recibidos
  const targetNum = targetID.split("@")[0];
  if (!data[chatId].slapRecibidos[targetNum]) {
    data[chatId].slapRecibidos[targetNum] = { total: 0, usuarios: {} };
  }
  if (!data[chatId].slapRecibidos[targetNum].usuarios[senderNum]) {
    data[chatId].slapRecibidos[targetNum].usuarios[senderNum] = 0;
  }
  data[chatId].slapRecibidos[targetNum].total += 1;
  data[chatId].slapRecibidos[targetNum].usuarios[senderNum] += 1;

  fs.writeFileSync(SLAP_PATH, JSON.stringify(data, null, 2));

  // Mensaje y gif aleatorio
  const gif = gifUrls[Math.floor(Math.random() * gifUrls.length)];
  const texto = textos[Math.floor(Math.random() * textos.length)]
    .replace("@1", `@${senderNum}`)
    .replace("@2", `@${targetNum}`);

  await conn.sendMessage(chatId, {
    video: { url: gif },
    gifPlayback: true,
    caption: texto,
    mentions: [senderID, targetID]
  }, { quoted: msg });
};

handler.command = ["slap"];
export default handler;
