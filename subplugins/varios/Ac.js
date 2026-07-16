// plugins/ac.js
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function safeIsOwner(msg) {
  try {
    const sender =
      msg.realJid ||
      msg.key?.participant ||
      msg.key?.remoteJid ||
      "";

    const numero = String(msg.realNumber || DIGITS(sender));

    if (typeof global.isOwner === "function") {
      if (global.isOwner(sender)) return true;
      if (global.isOwner(numero)) return true;
    }

    if (Array.isArray(global.owner)) {
      return global.owner.some((entry) => {
        if (Array.isArray(entry)) {
          return entry.some((x) => DIGITS(x) === numero);
        }
        return DIGITS(entry) === numero;
      });
    }

    return false;
  } catch {
    return false;
  }
}

const textoActualizacion = `🔥✨ *NUEVA ACTUALIZACIÓN DE SUKI* ✨🔥
🚀 *Suki Actualización On Fire* 🚀

La nueva actualización de *Suki Subbots* ya está lista con mejoras, comandos nuevos y más funciones para todos ustedes. 💖

╭━━━〔 🆕 *NOVEDADES* 〕━━━⬣

🎨 *Nuevo comando:* \`.sks\`
➤ Crea stickers animados con más de *50 efectos disponibles*.

📦 *Nuevo comando:* \`.guarsk\`
➤ Crea y guarda paquetes de stickers personalizados.

📤 *Nuevo comando:* \`.sendsk\`
➤ Suki envía el paquete de stickers creado.

🗑️ *Nuevo comando:* \`.delsk\`
➤ Elimina stickers dentro de un paquete guardado.

👀 *Nuevo comando:* \`.versk\`
➤ Muestra los paquetes de stickers creados.

⚙️ *Nuevo comando:* \`.reaccion on / off\`
➤ Activa o desactiva las respuestas/reacciones automáticas de Suki.

🔘 *Nuevo comando:* \`.botones on / off\`
➤ Activa o desactiva los botones en los comandos compatibles.

╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 🛠️ *MEJORAS IMPORTANTES* 〕━━━⬣

🔐 *Mejor manejo de LID y número real*
➤ Ahora Suki trabaja mejor con usuarios que aparecen como *LID* y también con número real.

👑 *Comando \`.addowner\` mejorado*
➤ Sigue funcionando para agregarte como owner.
➤ Solo debes usarlo desde el mismo número de Suki.
➤ En privado no envía notificación ni mensaje, pero sí funciona correctamente.
➤ Puedes citar el mensaje del usuario que quieres agregar como owner o escribir el número directamente.

📥 *Botones agregados en comandos de descarga*
➤ Ahora los comandos como:

• \`.play\`
• \`.play2\`
• \`.ytmp3\`
• \`.ytmp4\`
• \`.fb\`
• \`.tiktok\`

incluyen botones para una experiencia más rápida y cómoda. ⚡

╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 🤖 *PRÓXIMAMENTE* 〕━━━⬣

🧠 Se estarán arreglando y mejorando los comandos de IA que ya no estaban respondiendo correctamente.

🔥 Sigan pendientes, porque vienen más actualizaciones para *Suki Subbots*.

╰━━━━━━━━━━━━━━━━━━━━⬣

⭐ *Apoya el proyecto*
No olvides dejar tu estrella en el repositorio oficial de Suki para saber que les gusta el proyecto y seguir trayendo más actualizaciones nuevas. 💖

🔗 https://github.com/russellxz/LASUKIBOT.git

💜 Gracias por usar *Suki Subbots*.`;

const handler = async (msg, { conn, command }) => {
  const chatId = msg.key.remoteJid;

  if (!safeIsOwner(msg) && !msg.key.fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo los owners pueden usar este comando.*"
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, {
    react: { text: "🔥", key: msg.key }
  }).catch(() => {});

  if (command === "ac2") {
    return conn.sendMessage(chatId, {
      video: { url: "https://cdn.russellxz.click/64ce1e77.mp4" },
      caption: textoActualizacion
    }, { quoted: msg });
  }

  return conn.sendMessage(chatId, {
    image: { url: "https://cdn.russellxz.click/68f1ac26.jpg" },
    caption: textoActualizacion
  }, { quoted: msg });
};

handler.command = ["ac", "ac2"];
export default handler;
