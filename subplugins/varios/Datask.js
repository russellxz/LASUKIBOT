import { fileURLToPath as __fileURLToPath } from 'url';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function unwrapMessage(m) {

  let node = m;

  while (

    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message

  ) {

    node =

      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;

  }

  return node;

}

function ensureWA(wa, conn) {

  if (wa?.downloadContentFromMessage)
    return wa;

  if (conn?.wa?.downloadContentFromMessage)
    return conn.wa;

  if (global.wa?.downloadContentFromMessage)
    return global.wa;

  return null;

}

const handler = async (msg, { conn, wa }) => {

  const chatId =
    msg.key.remoteJid;

  const quotedRaw =
    msg.message?.extendedTextMessage
    ?.contextInfo?.quotedMessage;

  if (!quotedRaw) {

    return conn.sendMessage(chatId, {

      text:
"Responde a un sticker animado (.was)"

    }, { quoted: msg });

  }

  const q =
    unwrapMessage(quotedRaw);

  // detectar TODOS los tipos posibles
  const stickerMsg =
    q?.stickerMessage
    || q?.lottieStickerMessage?.message?.stickerMessage
    || q?.message?.stickerMessage;

  const docMsg =
    q?.documentMessage;

  if (!stickerMsg && !docMsg) {

    await conn.sendMessage(chatId, {

      text:
"No detecto sticker\n\nLOG:\n" +
JSON.stringify(q,null,2)

    }, { quoted: msg });

    return;

  }

  const node =
    stickerMsg || docMsg;

  const dlType =
    stickerMsg ? "sticker" : "document";

  await conn.sendMessage(chatId, {

    react:
    { text:"🧠", key:msg.key }

  }).catch(()=>{});

  const tmpDir =
    path.join(
      __dirname,
      "../tmp"
    );

  if (!fs.existsSync(tmpDir))
    fs.mkdirSync(tmpDir,{recursive:true});

  const base =
    Date.now();

  const inputFile =
    path.join(tmpDir, base + ".bin");

  const extractDir =
    path.join(tmpDir, base + "_files");

  try {

    const WA =
      ensureWA(wa,conn);

    const stream =
      await WA.downloadContentFromMessage(
        node,
        dlType
      );

    let buffer =
      Buffer.alloc(0);

    for await (const chunk of stream)

      buffer =
        Buffer.concat([buffer,chunk]);

    fs.writeFileSync(
      inputFile,
      buffer
    );

    // detectar tipo real
    let realType =
      "unknown";

    if (
      buffer.slice(0,4)
      .toString()
      === "PK\u0003\u0004"
    )
      realType = "WAS (ZIP)";

    if (
      buffer.slice(8,12)
      .toString()
      === "WEBP"
    )
      realType = "WEBP";

    // metadata del mensaje
    const metaInfo = {

      mimetype:
        node.mimetype,

      fileLength:
        node.fileLength,

      isAnimated:
        node.isAnimated,

      isLottie:
        node.isLottie,

      mediaKey:
        node.mediaKey,

      fileEncSha256:
        node.fileEncSha256,

      fileSha256:
        node.fileSha256,

      directPath:
        node.directPath,

      timestamp:
        node.mediaKeyTimestamp

    };

    await conn.sendMessage(chatId, {

      text:
"METADATA\n\n" +
JSON.stringify(metaInfo,null,2)

    }, { quoted: msg });

    // si es .was lo abrimos
    if (realType.includes("WAS")) {

      fs.mkdirSync(
        extractDir,
        {recursive:true}
      );

      execSync(
`unzip "${inputFile}" -d "${extractDir}"`
      );

      const files =
        fs.readdirSync(
          extractDir,
          {recursive:true}
        );

      await conn.sendMessage(chatId, {

        text:
"ARCHIVOS INTERNOS:\n\n" +
files.join("\n")

      }, { quoted: msg });

      // enviar TODOS los json
      for (const file of files) {

        if (!file.endsWith(".json"))
          continue;

        const full =
          path.join(
            extractDir,
            file
          );

        const json =
          fs.readFileSync(
            full,
            "utf8"
          );

        const parsed =
          JSON.parse(json);

        const resumen = {

          file,

          fr:
            parsed.fr,

          w:
            parsed.w,

          h:
            parsed.h,

          layers:
            parsed.layers?.length,

          assets:
            parsed.assets?.length,

          markers:
            parsed.markers?.length

        };

        await conn.sendMessage(chatId, {

          text:
"INFO JSON:\n\n" +
JSON.stringify(resumen,null,2)

        }, { quoted: msg });

        await conn.sendMessage(chatId, {

          document:
            Buffer.from(json),

          fileName:
            file,

          mimetype:
            "application/json"

        }, { quoted: msg });

      }

    }

    await conn.sendMessage(chatId, {

      react:
      { text:"✅", key:msg.key }

    });

  }
  catch (e) {

    console.log(e);

    await conn.sendMessage(chatId, {

      text:
"ERROR:\n" +
e.message

    }, { quoted: msg });

    await conn.sendMessage(chatId, {

      react:
      { text:"❌", key:msg.key }

    });

  }

};

handler.command =
["datask"];

handler.help =
["datask"];

handler.tags =
["tools"];

handler.register =
true;

export default handler;
