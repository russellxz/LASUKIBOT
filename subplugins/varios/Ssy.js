import fs from 'fs';
import path from 'path';

const DB = "./ssy_db.json";
const IMG_DIR = "./ssy_images";

if (!fs.existsSync(IMG_DIR))
fs.mkdirSync(IMG_DIR);

function unwrapMessage(m){

let n=m;

while(

n?.viewOnceMessage?.message ||
n?.viewOnceMessageV2?.message ||
n?.ephemeralMessage?.message

){

n=
n.viewOnceMessage?.message ||
n.viewOnceMessageV2?.message ||
n.ephemeralMessage?.message;

}

return n;
}

function ensureWA(wa,conn){

if(wa?.downloadContentFromMessage)
return wa;

if(conn?.wa?.downloadContentFromMessage)
return conn.wa;

return null;

}

function loadDB(){

if(!fs.existsSync(DB))
return {};

return JSON.parse(
fs.readFileSync(DB)
);

}

function saveDB(db){

fs.writeFileSync(
DB,
JSON.stringify(db,null,2)
);

}

const handler = async (msg,{conn,wa,args})=>{

const chatId =
msg.key.remoteJid;

const key =
(args||[]).join(" ")
.toLowerCase()
.trim();

if(!key){

return conn.sendMessage(chatId,{
text:
"usa:\n.ssy nombre"
},{quoted:msg});

}

const quoted =
msg.message?.extendedTextMessage
?.contextInfo?.quotedMessage;

const q =
unwrapMessage(quoted);

if(!q?.imageMessage){

return conn.sendMessage(chatId,{
text:
"responde a imagen"
},{quoted:msg});

}

const WA =
ensureWA(wa,conn);

const stream =
await WA.downloadContentFromMessage(
q.imageMessage,
"image"
);

let buffer =
Buffer.alloc(0);

for await(const chunk of stream)
buffer =
Buffer.concat([buffer,chunk]);

const file =
path.join(
IMG_DIR,
key+".png"
);

fs.writeFileSync(
file,
buffer
);

const db=
loadDB();

db[key]=file;

saveDB(db);

conn.sendMessage(chatId,{
text:
"guardado:\n"+key
},{quoted:msg});

};

handler.command=["ssy"];

export default handler;
