// plugins/sks.js — Creador de Stickers con 50 Efectos Pro
// Responde a una IMAGEN o VIDEO, muestra un menú con 50 efectos,
// y crea un sticker WebP (animado si es video) con el efecto aplicado.
//
// ✅ Usa la misma lógica de s.js (imageToWebp / videoToWebp + addExif)
// ✅ Menú de botones igual que play.js (nativeFlow con sections/rows)
// ✅ Respeta activoss.json (botones on/off)
// ✅ Menú activo 10 minutos — puedes probar varios efectos con la misma imagen
// ✅ Incluye stickers REDONDOS, animaciones (latido, rebote, shake, etc.)
//
// Uso: .sks  (respondiendo a una imagen o video)

"use strict";

import fs from 'fs';
import path from 'path';
import Crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import webp from 'node-webpmux';

const TMP_DIR = path.resolve("./tmp");
const ACTIVOSS_FILE = path.resolve("./activoss.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const pendingSks = Object.create(null);

// ====== HELPERS ======
function unwrapMessage(m) {
  let n = m;
  let depth = 0;
  while (n && depth < 10) {
    const next =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message ||
      n.documentWithCaptionMessage?.message ||
      null;
    if (!next) break;
    n = next;
    depth++;
  }
  return n;
}

function ensureWA(wa, conn) {
  if (wa && wa.downloadContentFromMessage) return wa;
  if (conn && conn.wa && conn.wa.downloadContentFromMessage) return conn.wa;
  if (global.wa && global.wa.downloadContentFromMessage) return global.wa;
  return null;
}

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).toString("hex")}.${ext}`;
}

// Los mensajes enviados desde iPhone tienen ID "3A" + 18 caracteres: ahí no
// salen los botones, se usa la versión de reacciones/números.
const esIphone = (m) => /^3A.{18}$/.test(String(m?.key?.id || ""));


function botonesActivos() {
  const defaultCfg = { botones: true, updatedAt: null, updatedBy: null };
  if (!fs.existsSync(ACTIVOSS_FILE)) {
    try { fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2)); } catch {}
    return true;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

// ====== 🎨 CATÁLOGO DE 50 EFECTOS ======
// Cada efecto puede tener:
//   - filter: filtro FFmpeg normal
//   - animFilter: filtro especial para animaciones (requiere loop + duración)
//   - needsAnimation: true si debe convertirse a video aunque la entrada sea imagen
const EFECTOS = {
  // ============ 🔄 TRANSFORMACIONES (8) ============
  normal: {
    label: "🖼️ Normal", desc: "Sin efecto, sticker clásico",
    section: "basic", filter: null,
  },
  flip_h: {
    label: "↔️ Voltear Derecha", desc: "Flip horizontal (espejo)",
    section: "basic", filter: "hflip",
  },
  flip_v: {
    label: "↕️ Voltear Izquierda", desc: "Flip vertical",
    section: "basic", filter: "vflip",
  },
  rot90: {
    label: "🔄 Voltear Redondo 90°", desc: "Gira 90 grados",
    section: "basic", filter: "transpose=1",
  },
  rot180: {
    label: "🔃 De Cabeza 180°", desc: "Pone de cabeza",
    section: "basic", filter: "transpose=2,transpose=2",
  },
  rot270: {
    label: "🔁 Voltear Redondo 270°", desc: "Gira 270 grados",
    section: "basic", filter: "transpose=2",
  },
  zoom_in: {
    label: "🔍 Zoom In", desc: "Acerca la imagen",
    section: "basic", filter: "crop=iw/1.5:ih/1.5:(iw-iw/1.5)/2:(ih-ih/1.5)/2",
  },
  zoom_out: {
    label: "🔭 Zoom Out", desc: "Aleja con marco",
    section: "basic", filter: "scale=iw*0.7:ih*0.7,pad=iw/0.7:ih/0.7:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
  },

  // ============ ⭕ FORMAS (2) ============
  redondo: {
    label: "⭕ Sticker Redondo", desc: "Forma circular perfecta",
    section: "shapes",
    // Máscara circular usando geq (recorta a círculo)
    filter: "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-W/2,Y-H/2),min(W,H)/2),255,0)'",
  },
  cuadrado: {
    label: "⬛ Forma Cuadrada", desc: "Marco con fondo negro",
    section: "shapes",
    filter: "pad=iw+40:ih+40:20:20:color=black",
  },

  // ============ 🎨 COLORES (10) ============
  bn: {
    label: "⚫ Blanco y Negro", desc: "Escala de grises",
    section: "colors", filter: "hue=s=0",
  },
  negativo: {
    label: "🌓 Negativo", desc: "Invierte los colores",
    section: "colors", filter: "negate",
  },
  sepia: {
    label: "🟤 Sepia", desc: "Foto antigua",
    section: "colors", filter: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
  },
  rojo: {
    label: "🔴 Tono Rojo", desc: "Tinte rojizo",
    section: "colors", filter: "hue=h=0:s=1.5",
  },
  azul: {
    label: "🔵 Tono Azul", desc: "Tinte azul",
    section: "colors", filter: "hue=h=210:s=1.5",
  },
  verde: {
    label: "🟢 Tono Verde", desc: "Tinte verde",
    section: "colors", filter: "hue=h=120:s=1.5",
  },
  amarillo: {
    label: "🟡 Tono Amarillo", desc: "Tinte amarillo",
    section: "colors", filter: "hue=h=60:s=1.5",
  },
  rosa: {
    label: "💖 Tono Rosa", desc: "Rosa / fucsia",
    section: "colors", filter: "hue=h=330:s=1.5",
  },
  morado: {
    label: "🟣 Tono Morado", desc: "Violeta / morado",
    section: "colors", filter: "hue=h=270:s=1.5",
  },
  naranja: {
    label: "🧡 Tono Naranja", desc: "Tinte anaranjado",
    section: "colors", filter: "hue=h=30:s=1.5",
  },

  // ============ ☀️ LUZ / AJUSTES (6) ============
  brillo: {
    label: "☀️ Más Brillo", desc: "Aumenta el brillo",
    section: "colors", filter: "eq=brightness=0.15:saturation=1.3",
  },
  contraste: {
    label: "🎯 Más Contraste", desc: "Mayor contraste",
    section: "colors", filter: "eq=contrast=1.5:saturation=1.2",
  },
  saturado: {
    label: "🌈 Súper Saturado", desc: "Colores intensos",
    section: "colors", filter: "eq=saturation=2.5",
  },
  oscuro: {
    label: "🌑 Oscuro", desc: "Nocturno",
    section: "colors", filter: "eq=brightness=-0.15:contrast=1.3",
  },
  calido: {
    label: "🌞 Cálido", desc: "Temperatura cálida",
    section: "colors", filter: "colorbalance=rs=0.3:gs=0.1:bs=-0.3",
  },
  frio: {
    label: "❄️ Frío", desc: "Temperatura fría",
    section: "colors", filter: "colorbalance=rs=-0.3:gs=-0.1:bs=0.3",
  },

  // ============ 🌫️ DESENFOQUE / PIXEL (5) ============
  difuminado: {
    label: "🌫️ Difuminado Suave", desc: "Blur suave",
    section: "blur", filter: "gblur=sigma=3",
  },
  difuminado_fuerte: {
    label: "💨 Difuminado Fuerte", desc: "Blur intenso",
    section: "blur", filter: "gblur=sigma=8",
  },
  pixelado: {
    label: "🔳 Pixelado", desc: "Efecto pixelado",
    section: "blur", filter: "scale=iw/8:ih/8,scale=iw*8:ih*8:flags=neighbor",
  },
  mosaico: {
    label: "📺 Mosaico Gigante", desc: "Cuadros grandes",
    section: "blur", filter: "scale=iw/15:ih/15,scale=iw*15:ih*15:flags=neighbor",
  },
  bit8: {
    label: "🖥️ 8-Bit Retro", desc: "Estilo videojuego retro",
    section: "blur", filter: "scale=iw/6:ih/6,scale=iw*6:ih*6:flags=neighbor,eq=saturation=2",
  },

  // ============ ⚡ GLITCH / RETRO (5) ============
  glitch_rgb: {
    label: "⚡ Glitch RGB", desc: "Canales RGB desplazados",
    section: "glitch", filter: "rgbashift=rh=8:bv=8:gh=-8",
  },
  tv_vieja: {
    label: "📺 TV Vieja", desc: "Ruido de TV antigua",
    section: "glitch", filter: "noise=alls=25:allf=t",
  },
  grano: {
    label: "🎞️ Grano de Película", desc: "Textura de grano",
    section: "glitch", filter: "noise=c0s=20:allf=t+u",
  },
  crt: {
    label: "💿 CRT Vintage", desc: "Monitor CRT antiguo",
    section: "glitch", filter: "curves=vintage,noise=alls=15:allf=t",
  },
  vhs: {
    label: "📼 VHS", desc: "Cinta VHS clásica",
    section: "glitch", filter: "curves=vintage,noise=c0s=8:allf=t,rgbashift=rh=3:bv=3",
  },

  // ============ 🎨 ARTÍSTICOS (9) ============
  vintage: {
    label: "📷 Vintage", desc: "Look retro con viñeta",
    section: "art", filter: "curves=vintage,vignette",
  },
  dibujo: {
    label: "🖋️ Dibujo / Edges", desc: "Detección de bordes",
    section: "art", filter: "edgedetect=mode=wires",
  },
  lapiz: {
    label: "✏️ Lápiz", desc: "Dibujo a lápiz",
    section: "art", filter: "edgedetect=low=0.1:high=0.4",
  },
  cartoon: {
    label: "🎨 Cartoon", desc: "Estilo caricatura",
    section: "art", filter: "edgedetect=mode=colormix:high=0",
  },
  comic: {
    label: "📖 Cómic", desc: "Estilo cómic colorido",
    section: "art", filter: "edgedetect=mode=colormix:high=0.3,eq=saturation=1.8",
  },
  cine: {
    label: "🎬 Cinemático", desc: "Look de cine",
    section: "art", filter: "curves=preset=increase_contrast,eq=saturation=0.85",
  },
  pastel: {
    label: "🌺 Pastel", desc: "Colores pastel suaves",
    section: "art", filter: "eq=saturation=0.7:brightness=0.08",
  },
  intenso: {
    label: "🔥 Intenso", desc: "Contraste + saturación máx",
    section: "art", filter: "eq=contrast=1.8:saturation=1.8:brightness=-0.05",
  },
  desaturado: {
    label: "🌅 Desaturado", desc: "Colores apagados",
    section: "art", filter: "eq=saturation=0.3",
  },

  // ============ 🎪 ANIMADOS (convierten imagen estática en animación) ============
  latido: {
    label: "💓 Latido", desc: "Palpita como corazón",
    section: "anim", needsAnimation: true,
    // Oscila escala usando zoompan
    animFilter: "scale=320:320,zoompan=z='1+0.1*abs(sin(2*PI*on/15))':d=1:s=320x320:fps=15",
  },
  rebote: {
    label: "🏀 Rebote", desc: "Sube y baja como pelota",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:300,pad=320:320:0:'8*abs(sin(3*PI*t))':color=0x00000000",
  },
  shake: {
    label: "🫨 Shake", desc: "Tiembla como gelatina",
    section: "anim", needsAnimation: true,
    animFilter: "scale=340:340,crop=320:320:'10+5*sin(8*PI*t)':'10+5*cos(8*PI*t)'",
  },
  girando: {
    label: "🌀 Girando", desc: "Rotación 360° continua",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,rotate='2*PI*t/2.5':c=none:ow=320:oh=320",
  },
  arcoiris_anim: {
    label: "🌈 Arcoíris Animado", desc: "Cambia colores en el tiempo",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,hue=h='360*t/2.5'",
  },
  pulso: {
    label: "✨ Pulso Brillante", desc: "Brilla y se apaga",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,eq=brightness='0.2*sin(4*PI*t)'",
  },
  flash: {
    label: "🎇 Flash/Parpadeo", desc: "Parpadea rápido",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,eq=brightness='0.3*sin(10*PI*t)'",
  },
  glitch_anim: {
    label: "🔀 Glitch Animado", desc: "Glitch RGB en movimiento",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,hue=h='30*sin(6*PI*t)':s='1+0.3*sin(8*PI*t)'",
  },
  fade_anim: {
    label: "🌗 Aparece/Desaparece", desc: "Fade in/out loop",
    section: "anim", needsAnimation: true,
    animFilter: "scale=320:320,fade=t=in:st=0:d=0.6:alpha=1,fade=t=out:st=1.9:d=0.6:alpha=1",
  },
};

// ====== FFMPEG: imagen estática → webp normal con efecto ======
async function imageToWebp(media, effectFilter) {
  const tmpIn = path.join(TMP_DIR, randomFileName("jpg"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  const baseFilter = "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse";
  const fullFilter = effectFilter ? `${effectFilter},${baseFilter}` : baseFilter;

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", fullFilter,
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}
  return buff;
}

// ====== FFMPEG: imagen estática → webp animado (para efectos de animación) ======
async function imageToAnimatedWebp(media, animFilter) {
  const tmpIn = path.join(TMP_DIR, randomFileName("jpg"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .inputOptions([
        "-loop", "1",
        "-t", "2.5",
      ])
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", `${animFilter},fps=15`,
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0",
        "-q:v", "60",
        "-pix_fmt", "yuva420p",
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}
  return buff;
}

// ====== FFMPEG: video → webp animado con efecto ======
async function videoToWebp(media, effectFilter) {
  const tmpIn = path.join(TMP_DIR, randomFileName("mp4"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  const baseFilter = "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse";
  const fullFilter = effectFilter ? `${effectFilter},${baseFilter}` : baseFilter;

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", fullFilter,
        "-loop", "0",
        "-ss", "00:00:00",
        "-t", "00:00:05",
        "-preset", "default",
        "-an",
        "-vsync", "0",
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}
  return buff;
}

// ====== Agregar EXIF (metadata) ======
async function addExif(webpBuffer, metadata) {
  const tmpIn = path.join(TMP_DIR, randomFileName("webp"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "suki-sks",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    emojis: metadata.categories || [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00,
  ]);

  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(tmpIn);
  img.exif = exif;
  await img.save(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  return tmpOut;
}

// ====== PROCESAR Y ENVIAR STICKER ======
async function procesarEfecto(conn, job, effectKey, triggerMsg) {
  const { chatId, mediaType, mediaBuffer, senderName, quotedBase } = job;
  if (job.isBusy) return;
  job.isBusy = true;

  try {
    const efecto = EFECTOS[effectKey];
    if (!efecto) throw new Error("Efecto no encontrado.");

    await conn.sendMessage(chatId, { react: { text: "🛠️", key: triggerMsg.key } });

    const fecha = new Date();
    const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()} ${fecha.getHours()}:${fecha.getMinutes()}`;

    const metadata = {
      packname: `✨ ${efecto.label} — ${senderName}`,
      author: `🦋 Bot Creador: ❦Suki Subbots❦\n🎨 Efecto: ${efecto.label}\n🛠️ Desarrollado por: Russell XZ 💻\n📅 ${fechaStr}`,
    };

    let webpBuffer;

    if (efecto.needsAnimation) {
      // Efecto requiere animación
      if (mediaType === "image") {
        // Imagen estática → webp animado
        webpBuffer = await imageToAnimatedWebp(mediaBuffer, efecto.animFilter);
      } else {
        // Video → aplicar también el filtro base como video
        webpBuffer = await videoToWebp(mediaBuffer, efecto.animFilter);
      }
    } else {
      // Efecto estático normal
      if (mediaType === "image") {
        webpBuffer = await imageToWebp(mediaBuffer, efecto.filter);
      } else {
        webpBuffer = await videoToWebp(mediaBuffer, efecto.filter);
      }
    }

    const outSticker = await addExif(webpBuffer, metadata);

    await conn.sendMessage(
      chatId,
      { sticker: { url: outSticker } },
      { quoted: quotedBase }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });

    try { fs.unlinkSync(outSticker); } catch {}
  } catch (err) {
    console.error("[sks] Error:", err);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `❌ Error al aplicar efecto: \`${err.message}\``,
    }, { quoted: quotedBase });
  } finally {
    job.isBusy = false;
  }
}

// ====== HANDLER PRINCIPAL ======
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = (typeof conn !== "undefined" && conn && conn.subPrefixes ? conn.subPrefixes : global.prefixes)?.[0] || ".";

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage && !quoted?.videoMessage) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Responde a una imagen o video para crear un sticker.*

✳️ Ejemplo:
*${pref}sks* (respondiendo a una imagen o video)

💡 Los videos se convierten en stickers *animados*.
🎨 *50 efectos disponibles* incluyendo latido, rebote, redondo, glitch y más.`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  let mediaBuffer, mediaType;
  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    mediaType = quoted.imageMessage ? "image" : "video";
    const mediaNode = quoted[`${mediaType}Message`];

    const stream = await WA.downloadContentFromMessage(mediaNode, mediaType);
    mediaBuffer = Buffer.alloc(0);
    for await (const chunk of stream) mediaBuffer = Buffer.concat([mediaBuffer, chunk]);

    if (!mediaBuffer.length) throw new Error("Media vacía.");
  } catch (e) {
    console.error("[sks] error descargando:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al descargar el media: \`${e.message}\``,
    }, { quoted: msg });
  }

  const senderName = msg.pushName || "Usuario";
  const usarBotones = botonesActivos() && !esIphone(msg);

  // Lista numerada (para OFF)
  const efectosEntries = Object.entries(EFECTOS);
  const listaNumerada = efectosEntries
    .map(([k, v], i) => `   *${i + 1}* →  ${v.label}`)
    .join("\n");

  const NUMERO_EFECTO = {};
  efectosEntries.forEach(([k], i) => { NUMERO_EFECTO[String(i + 1)] = k; });

  // 🎨 Caption
  const caption = usarBotones
    ? `
╭━━━━━━━━━━━━━━━━╮
🎨 *CREADOR SKS PRO* 🎨
╰━━━━━━━━━━━━━━━━╯

Toca el botón abajo para elegir el efecto que deseas aplicarle a tu sticker.

🎨 *50 efectos disponibles*
⏱️ *Menú activo por 10 minutos*

❦ Suki Subbots ❦
`.trim()
    : `
╭━━━━━━━━━━━━━━━━━━━━╮
🎨 *CREADOR SKS PRO* 🎨
╰━━━━━━━━━━━━━━━━━━━━╯

📎 *Media:* ${mediaType === "video" ? "🎬 Video (sticker animado)" : "🖼️ Imagen"}

━━━━━━━━━━━━━━━━━━━━
 *🎨 ELIGE UN EFECTO*
━━━━━━━━━━━━━━━━━━━━

Cita este mensaje y escribe el número:
${listaNumerada}

💡 El menú queda activo *10 minutos*. Puedes probar varios efectos con la misma imagen.

━━━━━━━━━━━━━━━━━━━━
❦ Suki Subbots ❦
━━━━━━━━━━━━━━━━━━━━`.trim();

  // ====== Construir secciones del menú dinámicamente ======
  const SECTION_TITLES = {
    basic: { title: "🔄 TRANSFORMACIONES", label: "FX" },
    shapes: { title: "⭕ FORMAS", label: "SHAPE" },
    colors: { title: "🎨 COLORES Y LUZ", label: "COLOR" },
    blur: { title: "🌫️ DESENFOQUE Y PIXEL", label: "BLUR" },
    glitch: { title: "⚡ GLITCH Y RETRO", label: "RETRO" },
    art: { title: "🎭 ARTÍSTICOS", label: "ART" },
    anim: { title: "🎬 ANIMADOS", label: "MOVE" },
  };

  const sectionMap = {};
  for (const [k, v] of efectosEntries) {
    if (!sectionMap[v.section]) sectionMap[v.section] = [];
    sectionMap[v.section].push({
      header: "",
      title: v.label,
      description: v.desc,
      id: `${pref}sks_${k}`,
    });
  }

  const sections = [];
  for (const secKey of ["basic", "shapes", "colors", "blur", "glitch", "art", "anim"]) {
    if (sectionMap[secKey] && sectionMap[secKey].length > 0) {
      sections.push({
        title: SECTION_TITLES[secKey].title,
        highlight_label: SECTION_TITLES[secKey].label,
        rows: sectionMap[secKey],
      });
    }
  }

  const nativeFlowButtons = [
    {
      text: "🎨 Menú de efectos",
      sections,
    },
  ];

  // ====== ENVIAR MENSAJE ======
  let preview;
  if (usarBotones) {
    try {
      preview = await conn.sendMessage(chatId, {
        text: caption,
        footer: "❦ Selecciona un efecto del menú ❦",
        buttons: nativeFlowButtons,
        headerType: 1,
      }, { quoted: msg });
    } catch (e) {
      console.log("[sks] menú nativo falló, fallback:", e.message);
      preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }
  } else {
    preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
  }

  // ====== GUARDAR JOB (10 minutos) ======
  pendingSks[preview.key.id] = {
    chatId,
    mediaType,
    mediaBuffer,
    senderName,
    quotedBase: msg,
    isBusy: false,
    _createdAt: Date.now(),
    numeroMap: NUMERO_EFECTO,
  };

  setTimeout(() => {
    delete pendingSks[preview.key.id];
  }, 10 * 60 * 1000);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  // ====== LISTENER ÚNICO ======
  if (!conn._sksListener) {
    conn._sksListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // 1) BOTONES / MENÚ INTERACTIVO
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.listResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            null;

          if (interactiveReply) {
            let selectedId = "";

            if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
              selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            } else if (interactiveReply?.paramsJson) {
              try {
                const params = JSON.parse(interactiveReply.paramsJson);
                selectedId = params.id || "";
              } catch {}
            } else if (interactiveReply?.body?.text) {
              selectedId = interactiveReply.body.text;
            }

            if (!selectedId) continue;
            if (!selectedId.includes("sks_")) continue;

            const match = selectedId.match(/sks_([a-z0-9_]+)/i);
            if (!match) continue;
            const effectKey = match[1].toLowerCase();
            if (!EFECTOS[effectKey]) continue;

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;

            if (ctxQuoted && pendingSks[ctxQuoted]) {
              job = pendingSks[ctxQuoted];
            } else {
              const jobsInChat = Object.values(pendingSks)
                .filter(j => j.chatId === m.key.remoteJid)
                .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobsInChat.length > 0) job = jobsInChat[0];
            }

            if (!job) continue;

            await procesarEfecto(conn, job, effectKey, m);
            continue;
          }

          // 2) RESPUESTAS CITADAS (número)
          const ctxReply = m.message?.extendedTextMessage?.contextInfo;
          const citado = ctxReply?.stanzaId;
          const job = pendingSks[citado];

          if (citado && job) {
            const texto = String(
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              ""
            ).trim().toLowerCase();

            const firstWord = texto.split(/\s+/)[0];
            const effectKey = job.numeroMap[firstWord];

            if (effectKey && EFECTOS[effectKey]) {
              await procesarEfecto(conn, job, effectKey, m);
            }
          }
        } catch (e) {
          console.error("[sks] listener error:", e);
        }
      }
    });
  }
};

handler.command = ["sks"];
handler.help = ["sks"];
handler.tags = ["stickers"];
export default handler;
