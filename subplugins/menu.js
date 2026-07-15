// subplugins/menu.js — Menú de comandos del subbot
const MENU_IMAGE = "https://cdn.russellxz.click/c678c800.jpg";

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const p = conn?.subPrefixes?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "📖", key: msg.key } }).catch(() => {});

  const caption = `
╭━━━━━━━━━━━━━━━━━━╮
   ❦ 𝑺𝑼𝑲𝑰 𝑺𝑼𝑩𝑩𝑶𝑻𝑺 ❦
╰━━━━━━━━━━━━━━━━━━╯

📌 *Prefijo actual:* ${ (conn?.subPrefixes || [".", "#", "/"]).join("  ") }

━━━━━━━━━━━━━━━━━━
⚙️ *CONFIGURACIÓN DEL SUBBOT*
━━━━━━━━━━━━━━━━━━
🔧 *${p}setprefix* — cambia tu prefijo
👥 *${p}addgrupo* — el subbot responde a todos en este grupo
✖️ *${p}delgrupo* — quita el grupo de la lista
📱 *${p}addlista +número* — permite a un usuario usarte en privado
✖️ *${p}dellista +número* — quita al usuario de la lista
🤖 *${p}bots* — subbots conectados y tiempo activo
🔗 *${p}code +número* — conecta a alguien más como subbot

━━━━━━━━━━━━━━━━━━
🎉 *BIENVENIDAS Y DESPEDIDAS*
━━━━━━━━━━━━━━━━━━
👋 *${p}welcome on/off* — activa/desactiva bienvenidas
🚪 *${p}despedidas on/off* — activa/desactiva despedidas
📝 *${p}setwelcome <texto>* — bienvenida personalizada
📝 *${p}setdespedidas <texto>* — despedida personalizada
🧹 *${p}delwelcome* — borra los textos personalizados

━━━━━━━━━━━━━━━━━━
🛡️ *SEGURIDAD DEL GRUPO*
━━━━━━━━━━━━━━━━━━
🗑️ *${p}antidelete on/off* — reenvía mensajes eliminados
🗑️ *${p}antideletepri on/off* — antidelete en privados (solo tú)
🔗 *${p}antilink on/off* — bloquea links de grupos de WhatsApp
🌐 *${p}linkall on/off* — bloquea todos los enlaces
🚫 *${p}antis on/off* — anti spam de stickers
🚷 *${p}antiarabe on/off* — bloquea prefijos prohibidos
👮 *${p}modoadmins on/off* — solo responde a admins y a ti
🚷 *${p}restchat <comando>* — restringe un comando

━━━━━━━━━━━━━━━━━━
👥 *ADMINISTRACIÓN DE GRUPOS*
━━━━━━━━━━━━━━━━━━
🦶 *${p}kick @user* — expulsa a un usuario
⛔ *${p}ban / ${p}unban @user* — banea comandos a un usuario
🔇 *${p}mute / ${p}unmute @user* — mutea a un usuario
👑 *${p}daradmins / ${p}quitaradmins @user*
📢 *${p}todos <texto>* — menciona a todos
🏷️ *${p}tag <texto>* — notificación oculta
🧾 *${p}infogrupo* — info del grupo
🔗 *${p}linkgrupo* — link del grupo
🔓 *${p}abrirgrupo* / 🔒 *${p}cerrargrupo*
⏰ *${p}abrir / ${p}cerrar <tiempo>* — abrir/cerrar programado
🖼️ *${p}setfoto* — cambia la foto del grupo
✏️ *${p}setname / ${p}setinfo* — nombre y descripción
📜 *${p}reglas / ${p}setreglas* — reglas del grupo
🗑️ *${p}delete* — borra el mensaje citado
🧹 *${p}delwar* — limpia advertencias
👻 *${p}fantasmas* — miembros inactivos
📊 *${p}totalchat* — mensajes por usuario
⚙️ *${p}configrupo* — ver configuración del grupo

━━━━━━━━━━━━━━━━━━
📥 *DESCARGAS*
━━━━━━━━━━━━━━━━━━
🎵 *${p}play <búsqueda>* — audio/video de YouTube (con botones)
🎵 *${p}play2 <búsqueda>*
🎧 *${p}ytmp3 <link>* — audio de YouTube
🎬 *${p}ytmp4 <link>* — video de YouTube
▶️ *${p}yt1* / *${p}yt2* / *${p}yt3* / *${p}yt4*
📸 *${p}ig <link>* — Instagram
📘 *${p}fb <link>* — Facebook
🎪 *${p}tiktok <link>* / *${p}tt2*
🐦 *${p}twitter <link>* — X/Twitter
🎶 *${p}spotify <búsqueda>*
📌 *${p}pinterest <búsqueda>* / *${p}pinvideo*
📦 *${p}apk <nombre>* — descargar APK
📂 *${p}mediafire <link>*
📝 *${p}letra <canción>* — letra de canciones

━━━━━━━━━━━━━━━━━━
🧰 *UTILIDADES*
━━━━━━━━━━━━━━━━━━
🖼️ *${p}perfil @usuario* — foto de perfil
👁️ *${p}ver* — reenvía imagen/video/audio citado
📖 *${p}menu* — este menú

━━━━━━━━━━━━━━━━━━
🤖 *Suki Subbots* — se irán agregando más comandos 💖
━━━━━━━━━━━━━━━━━━`.trim();

  return conn.sendMessage(
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
