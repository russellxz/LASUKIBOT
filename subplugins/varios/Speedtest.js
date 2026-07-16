import cp from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const exec = promisify(cp.exec).bind(cp);

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  await conn.sendMessage(chatId, {
    react: { text: "⏳", key: msg.key }
  });

  await conn.sendMessage(chatId, {
    text: "🚀 *Realizando prueba de velocidad...*",
    mentions: [msg.key.participant || msg.key.remoteJid],
  }, { quoted: msg });

  let o;
  try {
    o = await exec("python3 speed.py --secure --share");
  } catch (e) {
    o = e;
  }

  const { stdout, stderr } = o;

  if (stdout?.trim()) {
    let result = stdout.trim();
    const imageUrlMatch = result.match(/(https?:\/\/[^\s]+)/); // 🔧 FIX regex

    if (imageUrlMatch) {
      const imageUrl = imageUrlMatch[0];
      try {
        const imageRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const imageBuffer = Buffer.from(imageRes.data);

        const tmpDir = path.resolve("./tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
        const imagePath = path.join(tmpDir, "speedtest.png");

        fs.writeFileSync(imagePath, imageBuffer);

        await conn.sendMessage(chatId, {
          image: { url: imagePath },
          caption: `📊 *Resultados de Speedtest:*\n\n${result.replace(imageUrl, "").trim()}`
        }, { quoted: msg });

        fs.unlinkSync(imagePath);
      } catch (err) {
        console.error("❌ Error descargando imagen:", err);
        await conn.sendMessage(chatId, {
          text: `⚠️ No se pudo descargar la imagen de Speedtest.\n\n📃 Resultado:\n${result}`
        }, { quoted: msg });
      }
    } else {
      await conn.sendMessage(chatId, {
        text: result
      }, { quoted: msg });
    }
  }

  if (stderr?.trim()) {
    await conn.sendMessage(chatId, {
      text: `⚠️ *Error en Speedtest:*\n\n${stderr}`
    }, { quoted: msg });
    console.log(stderr);
  }

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });
};

handler.command = ["speedtest", "speed"];
export default handler;
