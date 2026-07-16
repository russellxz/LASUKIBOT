// Adaptado a tu bot (CommonJS + conn.sendMessage)
import fetch from 'node-fetch';

const handler = async (msg, { conn, text, args }) => {
  const chatId = msg.key.remoteJid;
  const raw = (text && text.trim()) || (args || []).join(" ").trim();

  if (!raw) {
    return conn.sendMessage(
      chatId,
      {
        text:
          "👻 Uso: .react <link_post> <emoji1,emoji2,emoji3,emoji4>\n\n" +
          "Ejemplo:\n.rc https://whatsapp.com/channel/0029Vb6D6ogBVJl60Yr8YL31/473 😨,🤣,👾,😳",
      },
      { quoted: msg }
    );
  }

  // reacción de “procesando…”
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    // separa "<link> <emojis...>"
    const sp = raw.indexOf(" ");
    const postLink = sp === -1 ? raw : raw.slice(0, sp).trim();
    const reactsStr = sp === -1 ? "" : raw.slice(sp + 1).trim();

    if (!postLink || !reactsStr) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "⚠️ Formato incorrecto.\n\nUso: .rc <link_post> <emoji1,emoji2,emoji3,emoji4>" },
        { quoted: msg }
      );
    }

    if (!/whatsapp\.com\/channel\//i.test(postLink)) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "🚫 El link debe ser de una publicación de *canal de WhatsApp*." },
        { quoted: msg }
      );
    }

    // permite coma normal y coma china
    const emojiArray = reactsStr
      .split(/[,，]/)
      .map((e) => e.trim())
      .filter(Boolean);

    if (emojiArray.length === 0) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "⚠️ Debes indicar al menos 1 emoji." },
        { quoted: msg }
      );
    }

    if (emojiArray.length > 4) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "❗ Máximo 4 emojis permitidos." },
        { quoted: msg }
      );
    }

    // usa variable de entorno si la tienes; si no, reemplaza el placeholder
    const apiKey = process.env.REACT_API_KEY || "42699f4385a23f089abfd6948dd6ff366db8aef340eab58f69839b885b8b5e75";

    const requestData = {
      post_link: postLink,
      reacts: emojiArray.join(","),
    };

    const response = await fetch(
      "https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/channel/react-to-post",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent":
            "Mozilla/5.0 (Android 13; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0",
          Referer: "https://asitha.top/channel-manager",
        },
        body: JSON.stringify(requestData),
      }
    );

    const result = await response.json().catch(() => ({}));

    if (response.ok && (result?.message || result?.success)) {
      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
      await conn.sendMessage(
        chatId,
        { text: "✅ Reacciones enviadas con éxito 👻" },
        { quoted: msg }
      );
    } else {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      await conn.sendMessage(
        chatId,
        {
          text:
            "❌ Error al enviar las reacciones.\n" +
            (result?.error || result?.message || ""),
        },
        { quoted: msg }
      );
    }
  } catch (err) {
    console.error("[react] Error:", err);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(
      chatId,
      { text: "⚠️ Ocurrió un error al procesar la solicitud." },
      { quoted: msg }
    );
  }
};

handler.command = ["r", "rc", "channelreact"];
export default handler;
