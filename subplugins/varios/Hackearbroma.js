const handler = async (msg, { conn, args, usedPrefix, command }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  // Detectar a quién "hackear": mención > mensaje citado > uno mismo
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  let objetivo =
    ctx?.mentionedJid?.[0] ||
    ctx?.participant ||
    sender;

  const numero = objetivo.replace(/[^0-9]/g, "");

  await conn.sendMessage(chatId, { react: { text: "🕵️", key: msg.key } });

  // ====== DATOS FALSOS ALEATORIOS ======
  const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const ubicaciones = [
    "🏚️ Un búnker abandonado en Chernóbil",
    "🏝️ Una isla desierta sin nombre en el Pacífico",
    "🏙️ El sótano de un edificio en Tokio",
    "🌵 En medio del desierto del Sahara",
    "🏔️ Una cabaña oculta en los Alpes Suizos",
    "🚇 Los túneles secretos del metro de Nueva York",
    "🕳️ Un agujero a 300 metros bajo tierra",
    "🛰️ La Estación Espacial Internacional (?)",
    "🏰 Un castillo embrujado en Transilvania",
    "🌊 Una casa flotante en las Bermudas"
  ];

  const dispositivos = [
    "📱 Nokia 3310 (indestructible)",
    "💻 Una tostadora con WiFi",
    "📟 Un beeper de los años 90",
    "🖥️ Windows 95 corriendo en una refri",
    "📱 iPhone hecho de cartón",
    "⌚ Un reloj Casio hackeado",
    "🎮 Un Tamagotchi conectado a internet"
  ];

  const navegadores = [
    "Internet Explorer 6 💀",
    "Netscape Navigator 🦖",
    "Un navegador hecho en Excel",
    "Chrome con 999 pestañas abiertas"
  ];

  const passwords = [
    "12345••••••",
    "contraseña••••",
    "amoamimamá••",
    "•••••••••••••",
    "quesoConMiel••",
    "noEsMiPass123••"
  ];

  const isps = ["Telecable Galáctico", "Fibra de Papa", "WiFi del Vecino S.A.", "Router con Aluminio"];

  const nivelHacker = randNum(78, 100);
  const archivos = randNum(1200, 99999);
  const ip = `${randNum(1,255)}.${randNum(0,255)}.${randNum(0,255)}.${randNum(0,255)}`;

  // ====== SECUENCIA DE MENSAJES (se editan cada 4s) ======
  const steps = [
    "🔓 Iniciando protocolo de hackeo...\n`[▓░░░░░░░░░] 10%`",
    "📡 Conectando a los servidores del FBI...\n`[▓▓▓░░░░░░░] 30%`",
    "👤 Cargando información del usuario...\n`[▓▓▓▓░░░░░░] 45%`",
    "📥 Descargando datos privados...\n`[▓▓▓▓▓▓░░░░] 60%`",
    "🖼️ Descargando foto de perfil...\n`[▓▓▓▓▓▓▓░░░] 70%`",
    "📍 Rastreando ubicación en tiempo real...\n`[▓▓▓▓▓▓▓▓░░] 85%`",
    "🔑 Descifrando contraseñas...\n`[▓▓▓▓▓▓▓▓▓░] 95%`",
    "💀 Accediendo a la cámara y micrófono...\n`[▓▓▓▓▓▓▓▓▓▓] 99%`",
    "✅ ¡HACKEO COMPLETADO CON ÉXITO! 😈\n`[▓▓▓▓▓▓▓▓▓▓] 100%`"
  ];

  let { key } = await conn.sendMessage(chatId, { text: steps[0] }, { quoted: msg });
  for (let i = 1; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 4000));
    await conn.sendMessage(chatId, { text: steps[i], edit: key }, { quoted: msg });
  }

  await new Promise(r => setTimeout(r, 1500));

  // ====== INTENTAR OBTENER FOTO DE PERFIL REAL ======
  let ppUrl = "https://cdn.russellxz.click/4a6dea0d.jpg"; // por defecto
  try {
    ppUrl = await conn.profilePictureUrl(objetivo, "image");
  } catch (e) {
    // sin foto o privada, se queda la por defecto
  }

  // ====== MENSAJE FINAL FALSO ======
  const texto =
    `🚨 *INFORMACIÓN DEL USUARIO HACKEADO* 🚨\n` +
    `_(veamos la informacion del usuario☠️)_\n\n` +
    `👤 *Víctima:* +${numero}\n` +
    `📞 *Número real detectado:* +${numero}\n` +
    `🌐 *Dirección IP:* ${ip}\n` +
    `📡 *Proveedor de internet:* ${random(isps)}\n` +
    `📍 *Ubicación actual:* ${random(ubicaciones)}\n` +
    `📱 *Dispositivo:* ${random(dispositivos)}\n` +
    `🌍 *Navegador:* ${random(navegadores)}\n` +
    `🔑 *Contraseña filtrada:* ${random(passwords)}\n` +
    `📂 *Archivos robados:* ${archivos} archivos\n` +
    `🧠 *Nivel de peligrosidad:* ${nivelHacker}%\n` +
    `💳 *Tarjetas encontradas:* ${randNum(0,5)} (todas vencidas 💀)\n` +
    `📸 *Fotos comprometedoras:* ${randNum(0,100)} (bloqueadas por ternura 🥺)\n\n` +
    `⚠️ *ACCESO TOTAL AL DISPOSITIVO CONCEDIDO* ⚠️\n\n` +
    `😂 *Es una broma jajaja*, ningún dato es real.\n` +
    `_Cortesía de Suki Subbots 🤖_`;

  await conn.sendMessage(chatId, {
    image: { url: ppUrl },
    caption: texto,
    mentions: [objetivo]
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "😈", key: msg.key } });
};

handler.command = ["hackear", "hack"];
export default handler;
