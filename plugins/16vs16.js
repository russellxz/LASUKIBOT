const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const senderNum = sender.replace(/[^0-9]/g, "");
  const isOwner = global.owner.some(([id]) => id === senderNum);
  const isFromMe = msg.key.fromMe;

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo puede usarse en grupos." }, { quoted: msg });
  }

  const meta = await conn.groupMetadata(chatId);
  const isAdmin = await isAdminInGroup(conn, chatId, msg.realJid || sender);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "❌ Solo *admins* o *el dueño del bot* pueden usar este comando."
    }, { quoted: msg });
  }

  const horaTexto = args.join(" ").trim();
  if (!horaTexto) {
    return conn.sendMessage(chatId, {
      text: "✳️ Usa el comando así:\n*.16vs16 [hora]*\nEjemplo: *.16vs16 7:00pm*"
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '🎯', key: msg.key } });

  // Función de conversión
  const to24Hour = (str) => {
    let [time, modifier] = str.toLowerCase().split(/(am|pm)/);
    let [h, m] = time.split(":").map(n => parseInt(n));
    if (modifier === 'pm' && h !== 12) h += 12;
    if (modifier === 'am' && h === 12) h = 0;
    return { h, m: m || 0 };
  };

  const to12Hour = (h, m) => {
    const suffix = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')}${suffix}`;
  };

  const base = to24Hour(horaTexto);
  const zonas = [
    { pais: "🇲🇽 MÉXICO", offset: 0 },
    { pais: "🇨🇴 COLOMBIA", offset: 0 },
    { pais: "🇵🇪 PERÚ", offset: 0 },
    { pais: "🇵🇦 PANAMÁ", offset: 0 },
    { pais: "🇸🇻 EL SALVADOR", offset: 0 },
    { pais: "🇨🇱 CHILE", offset: 2 },
    { pais: "🇦🇷 ARGENTINA", offset: 2 },
    { pais: "🇪🇸 ESPAÑA", offset: 7 }
  ];
  const horaMsg = zonas.map(z => {
    let newH = base.h + z.offset;
    if (newH >= 24) newH -= 24;
    return `${z.pais} : ${to12Hour(newH, base.m)}`;
  }).join("\n");

  const participantes = meta.participants.filter(p => p.id !== conn.user.id);
  if (participantes.length < 30) {
    return conn.sendMessage(chatId, {
      text: "⚠️ Se necesitan al menos *30 usuarios* para formar 5 escuadras de 4 + 10 suplentes."
    }, { quoted: msg });
  }

  const tempMsg = await conn.sendMessage(chatId, {
    text: "🎮 Preparando escuadras para Free Fire 16vs16..."
  }, { quoted: msg });

  const pasos = [
    "⚙️ Configurando batalla 16 vs 16...",
    "🎲 Barajando escuadras...",
    "📋 Dividiendo jugadores...",
    "✅ ¡Listo! Revisa los equipos:"
  ];

  for (let i = 0; i < pasos.length; i++) {
    await new Promise(r => setTimeout(r, 1500));
    await conn.sendMessage(chatId, {
      edit: tempMsg.key,
      text: pasos[i]
    });
  }

  const shuffled = participantes.sort(() => Math.random() - 0.5);
  const equipos = [];
  const suplentes = [];

  for (let i = 0; i < 5; i++) {
    equipos.push(shuffled.slice(i * 4, i * 4 + 4));
    suplentes.push(shuffled.slice(20 + i * 2, 20 + i * 2 + 2));
  }

  const renderJugadores = (arr) => arr.map((u, i) => `${i === 0 ? "👑" : "🥷🏻"} ┇ @${u.id.split("@")[0]}`).join("\n");

  let textoFinal = `*🔥 16 𝐕𝐒 16 - 5 ESCUADRAS 🔥*\n\n⏱ 𝐇𝐎𝐑𝐀𝐑𝐈𝐎\n${horaMsg}\n\n➥ 𝐌𝐎𝐃𝐀𝐋𝐈𝐃𝐀𝐃: 🔫 Clásico\n➥ 𝐉𝐔𝐆𝐀𝐃𝐎𝐑𝐄𝐒:\n`;

  for (let i = 0; i < 5; i++) {
    textoFinal += `\n     𝗘𝗦𝗖𝗨𝗔𝗗𝗥𝗔 ${i + 1}\n\n${renderJugadores(equipos[i])}\n\n    ㅤʚ 𝐒𝐔𝐏𝐋𝐄𝐍𝐓𝐄𝐒:\n${renderJugadores(suplentes[i])}\n`;
  }

  const mentions = [...equipos.flat(), ...suplentes.flat()].map(p => p.id);

  await conn.sendMessage(chatId, {
    edit: tempMsg.key,
    text: textoFinal,
    mentions
  });
};

handler.command = ['16vs16'];
export default handler;
