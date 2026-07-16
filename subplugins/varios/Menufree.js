const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  await conn.sendMessage2(chatId, { react: { text: "📋", key: msg.key } }, msg);

  const texto = `𖠺𝑆𝑢𝑏𝑏𝑜𝑡𝑠 𝑆𝑢𝑘𝑖𖠺

𖠁𝗠𝗘𝗡𝗨 𝗙𝗥𝗘𝗘 𝗙𝗜𝗥𝗘𖠁
𖠁𝗣𝗿𝗲𝗳𝗶𝗷𝗼 𝗔𝗰𝘁𝘂𝗮𝗹: 『 ${pref} 』
𖠁𝗨𝘀𝗮 𝗲𝗻 𝗰𝗮𝗱𝗮 𝗰𝗼𝗺𝗮𝗻𝗱𝗼

🍉 *MAPAS*
╭─────◆
│๛ ${pref}mapas
╰─────◆

📃 *REGLAS*
╭─────◆
│๛ ${pref}reglas
│๛ ${pref}setreglas
╰─────◆

🛡️ *LISTA DE VERSUS*
╭─────◆
│๛ ${pref}4vs4
│๛ ${pref}6vs6
│๛ ${pref}12vs12
│๛ ${pref}16vs16
│๛ ${pref}20vs20
│๛ ${pref}24vs24
│๛ ${pref}guerr
╰─────◆

🎮 *Sistema personalizado para clanes FF*

🤖 *Suki Subbots*`.trim();

  await conn.sendMessage2(chatId, {
    image: { url: 'https://cdn.russellxz.click/707c3d7c.jpg' },
    caption: texto
  }, msg);
};

handler.command = ['menufree'];
handler.help = ['menufree'];
handler.tags = ['menu'];
handler.register = true;

export default handler;
