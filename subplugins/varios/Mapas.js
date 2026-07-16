const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  await conn.sendMessage(chatId, { react: { text: "🗺️", key: msg.key } });

  // Animaciones
  const pasos = [
    "🎲 Seleccionando mapa para el desafío...",
    "🧠 Analizando terreno...",
    "📡 Cargando coordenadas...",
    "✅ Mapa seleccionado:"
  ];

  const tempMsg = await conn.sendMessage(chatId, {
    text: pasos[0]
  }, { quoted: msg });

  for (let i = 1; i < pasos.length; i++) {
    await new Promise(r => setTimeout(r, 1500));
    await conn.sendMessage(chatId, {
      edit: tempMsg.key,
      text: pasos[i]
    });
  }

  // Lista de mapas
  const mapas = [
    "https://cdn.russellxz.click/b55d4ed4.jpeg",
    "https://cdn.russellxz.click/175045dc.jpeg",
    "https://cdn.russellxz.click/2559d309.jpeg",
    "https://cdn.russellxz.click/b7a5b400.jpeg"
  ];

  const elegido = mapas[Math.floor(Math.random() * mapas.length)];

  // Enviar imagen del mapa
  await conn.sendMessage(chatId, {
    image: { url: elegido },
    caption: "🌍 *Mapa asignado para el desafío.*\nPrepárense estrategas, el terreno ya está listo."
  }, { quoted: msg });
};

handler.command = ['mapas'];
export default handler;
