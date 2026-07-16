import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "✨", key: msg.key } }, msg); } catch {}

  let customText = null;
  let customImgB64 = null;

  try {
    const filePath = path.resolve("./setmenu.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (typeof data?.texto_grupo === "string" && data.texto_grupo.trim().length) {
        customText = data.texto_grupo;
      }
      if (typeof data?.imagen_grupo === "string" && data.imagen_grupo.length) {
        customImgB64 = data.imagen_grupo;
      }
    }
  } catch (e) {
    console.error("[menugrupo] error leyendo setmenu.json:", e);
  }

  if (customText || customImgB64) {
    try {
      if (customImgB64) {
        const buf = Buffer.from(customImgB64, "base64");
        await conn.sendMessage2(
          chatId,
          { image: buf, caption: customText || "" },
          msg
        );
      } else {
        await conn.sendMessage2(chatId, { text: customText }, msg);
      }
    } catch (e) {
      console.error("[menugrupo] error enviando personalizado:", e);
    }
    return;
  }

  const caption = `╔════════════════╗
     💠 𝙱𝙸𝙴𝙽𝚅𝙴𝙽𝙸𝙳𝙾 💠
╚════════════════╝
*𝐴𝑙 𝑚𝑒𝑛𝑢 𝑑𝑒 𝑔𝑟𝑢𝑝𝑜 𝑑𝑒 𝑆𝑢𝑏𝑏𝑜𝑡𝑠 𝑆𝑢𝑘𝑖*

🛠️ *CONFIGURACIONES*
╭─────◆
│๛ ${pref}reaccion off / on
│๛ ${pref}infogrupo
│๛ ${pref}setinfo
│๛ ${pref}setname
│๛ ${pref}setwelcome
│๛ ${pref}delwelcome ELIMINA DESPEDIDAS TAMBIEN.
│๛ ${pref}setdespedidas
│๛ ${pref}setfoto
│๛ ${pref}setreglas
│๛ ${pref}reglas
│๛ ${pref}welcome on/off
│๛ ${pref}despedidas on/off
│๛ ${pref}modoadmins on/off
│๛ ${pref}antilink on/off
│๛ ${pref}linkall on/off
│๛ ${pref}antis on/off
│๛ ${pref}antidelete on/off
│๛ ${pref}antiarabe on/off
│๛ ${pref}configrupo
│๛ ${pref}addco / comando a Stikerz
│๛ ${pref}delco / elimina comandos en s
╰─────◆

🛡️ *ADMINISTRACIÓN*
╭─────◆
│๛ ${pref}promote
│๛ ${pref}demote
│๛ ${pref}daradmins
│๛ ${pref}quitaradmins
│๛ ${pref}kick
│๛ ${pref}tag
│๛ ${pref}tagall
│๛ ${pref}todos
│๛ ${pref}invocar
│๛ ${pref}totalchat
│๛ ${pref}restchat
│๛ ${pref}fantasmas
│๛ ${pref}fankick
│๛ ${pref}delete
│๛ ${pref}linkgrupo
│๛ ${pref}mute
│๛ ${pref}unmute
│๛ ${pref}ban
│๛ ${pref}unban
│๛ ${pref}restpro
│๛ ${pref}abrir / automáticamente
│๛ ${pref}cerrar / automáticamente
│๛ ${pref}abrirgrupo
│๛ ${pref}cerrargrupo
╰─────◆

🤖 *Suki Subbots - Panel de control grupal*
`.trim();

  await conn.sendMessage2(
    chatId,
    {
      image: { url: "https://cdn.russellxz.click/c678c800.jpg" },
      caption
    },
    msg
  );
};

handler.command = ["menugrupo", "grupomenu"];
handler.help = ["menugrupo"];
handler.tags = ["menu"];

export default handler;
