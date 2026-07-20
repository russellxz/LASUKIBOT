// subplugins/menu.js — Menú general del subbot (estilo del menú principal,
// con diseño propio y la imagen de los subbots)
const MENU_IMAGE = "https://cdn.russellxz.click/c678c800.jpg";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = (Array.isArray(conn?.subPrefixes) && conn.subPrefixes[0]) || ".";

  try { await conn.sendMessage(chatId, { react: { text: "✨", key: msg.key } }); } catch {}

  const caption = `⟡─── ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦ ───⟡

⟡ 𝙈𝙀𝙉𝙐 𝙂𝙀𝙉𝙀𝙍𝘼𝙇 ⟡
⟡ 𝗣𝗿𝗲𝗳𝗶𝗷𝗼 𝗔𝗰𝘁𝘂𝗮𝗹: 〔 ${pref} 〕
⟡ 𝗨𝘀𝗮𝗹𝗼 𝗲𝗻 𝗰𝗮𝗱𝗮 𝗰𝗼𝗺𝗮𝗻𝗱𝗼

⟡ 𝙄𝙉𝙁𝙊𝙍𝙈𝘼𝘾𝙄𝙊𝙉 ⟡
┌───⟡
│ ✦ ${pref}ping
│ ✦ ${pref}speedtest
│ ✦ ${pref}creador
│ ✦ ${pref}bots
└───⟡

⟡ 𝙈𝙀𝙉𝙐𝙎 𝘿𝙄𝙎𝙋𝙊𝙉𝙄𝘽𝙇𝙀𝙎 ⟡
┌───⟡
│ ✦ ${pref}menugrupo
│ ✦ ${pref}menuaudio
│ ✦ ${pref}menurpg
│ ✦ ${pref}menufree
│ ✦ ${pref}allmenu
└───⟡

⟡ 𝙎𝙐𝘽𝘽𝙊𝙏 ⟡
┌───⟡
│ ✦ ${pref}code +número
│ ✦ ${pref}addgrupo / delgrupo
│ ✦ ${pref}addlista / dellista
│ ✦ ${pref}setprefix
│ ✦ ${pref}reprefix
│ ✦ ${pref}antideletepri on/off
└───⟡

⟡ 𝙄𝘼 - 𝘾𝙃𝘼𝙏 𝘽𝙊𝙏 ⟡
┌───⟡
│ ✦ ${pref}gemini
│ ✦ ${pref}chatgpt
│ ✦ ${pref}dalle
│ ✦ ${pref}vision / vision2
│ ✦ ${pref}chat on/off
│ ✦ ${pref}luminai
└───⟡

⟡ 𝘿𝙀𝙎𝘾𝘼𝙍𝙂𝘼𝙎 ⟡
┌───⟡
│ ✦ ${pref}play / play2
│ ✦ ${pref}ytmp3 / ytmp4
│ ✦ ${pref}tiktok / fb / ig / spotify
│ ✦ ${pref}mediafire / apk
│ ✦ ${pref}x / twitter / tw
└───⟡

⟡ 𝘽𝙐𝙎𝘾𝘼𝘿𝙊𝙍𝙀𝙎 ⟡
┌───⟡
│ ✦ ${pref}pixai
│ ✦ ${pref}tiktoksearch
│ ✦ ${pref}yts
│ ✦ ${pref}tiktokstalk
└───⟡

⟡ 𝘾𝙊𝙉𝙑𝙀𝙍𝙏𝙄𝘿𝙊𝙍𝙀𝙎 ⟡
┌───⟡
│ ✦ ${pref}tomp3 / toaudio
│ ✦ ${pref}hd / tts
│ ✦ ${pref}tovideo / toimg
│ ✦ ${pref}gifvideo / ff / ff2
└───⟡

⟡ 𝙎𝙏𝙄𝘾𝙆𝙀𝙍𝙎 ⟡
┌───⟡
│ ✦ ${pref}s / qc / qc2 / texto
│ ✦ ${pref}mixemoji / aniemoji
│ ✦ ${pref}sks / guarsk
│ ✦ ${pref}versk / sendsk
└───⟡

⟡ 𝙃𝙀𝙍𝙍𝘼𝙈𝙄𝙀𝙉𝙏𝘼𝙎 ⟡
┌───⟡
│ ✦ ${pref}ver / perfil / get
│ ✦ ${pref}tourl / whatmusic
└───⟡

⟡ 𝙈𝙄𝙉𝙄 𝙅𝙐𝙀𝙂𝙊𝙎 ⟡
┌───⟡
│ ✦ ${pref}verdad / reto
│ ✦ ${pref}personalidad
│ ✦ ${pref}parejas / ship
│ ✦ ${pref}kiss / topkiss
│ ✦ ${pref}slap / topslap
│ ✦ ${pref}menurpg
└───⟡

✨ Gracias por usar *Suki Subbots*. Eres adorable 💖`.trim();

  await conn.sendMessage(
    chatId,
    {
      image: { url: MENU_IMAGE },
      caption
    },
    { quoted: msg }
  );
};

handler.command = ["menu", "menú", "help"];
export default handler;
