// subplugins/code.js — Conectar a otros usuarios como subbots desde un subbot
// Uso: .code +507 6500-7845   (México: .code +52 y el resto, el 1 se agrega solo)
import { handleCodeCommand } from "../subbots.js";

const handler = async (msg, { conn, args }) => {
  await handleCodeCommand(msg, { conn, args, botName: "Suki Subbots" });
};

handler.command = ["code"];
export default handler;
