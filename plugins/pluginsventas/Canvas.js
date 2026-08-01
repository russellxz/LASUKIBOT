import fs from 'fs';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const filePath = "./ventas365.json";

  const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
  const canvas = data[chatId]?.setcanvas;

  if (!canvas) {
    return conn.sendMessage(chatId, {
      text: "🖼️ No hay canvas configurado para este grupo.",
    }, { quoted: msg });
  }

  if (canvas.imagen) {
    const buffer = Buffer.from(canvas.imagen, "base64");
    await conn.sendMessage(chatId, {
      image: buffer,
      caption: canvas.texto
    }, { quoted: msg });
  } else {
    await conn.sendMessage(chatId, {
      text: canvas.texto
    }, { quoted: msg });
  }
};

handler.command = ["canvas", "canva"];
export default handler;
