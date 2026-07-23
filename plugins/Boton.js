// plugins/Boton.js — Prueba: envía un botón que copia el texto "1234"
const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  try {
    await conn.sendMessage(
      chatId,
      {
        text: "🔢 *Botón de prueba*\n\nToca el botón de abajo para copiar el código 👇",
        footer: "❦ La Suki Bot ❦",
        nativeFlow: [
          {
            text: "📋 Copiar código",
            copy: "1234"
          }
        ]
      },
      { quoted: msg }
    );
  } catch (e) {
    console.error("Error en boton:", e);
    await conn.sendMessage(chatId, { text: "❌ No se pudo enviar el botón." }, { quoted: msg }).catch(() => {});
  }
};

handler.command = ["boton"];
export default handler;
