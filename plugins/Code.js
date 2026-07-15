// plugins/Code.js — Conectarse al sistema de Subbots desde el bot principal
// Uso: .code +507 6500-7845   (México: .code +52 y el resto, el 1 se agrega solo)
import { handleCodeCommand } from "../subbots.js";

const handler = async (msg, { conn, args }) => {
  await handleCodeCommand(msg, { conn, args, botName: "La Suki Bot" });
};

handler.command = ["code"];
export default handler;
