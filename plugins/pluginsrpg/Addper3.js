// plugins/pluginsrpg/Addper3.js — Agregar personajes de anime al RPG solo.
//
// Junta lo que ya hacían tres comandos: busca en Pinterest como .pinterestimg,
// sube la imagen al CDN como .tourl y lo mete en la tienda como .addper. Los
// nombres y las habilidades salen de catalogo-anime.json, así que no hay que
// escribir nada a mano.
//
// Los personajes que ya estaban en la tienda con la foto en el CDN viejo (que
// ya no funciona) van primero: se les busca foto nueva y se cambia en la
// tienda y en las copias de los usuarios, sin tocar precio ni habilidades.
// Cuando no queda ninguno, sigue con personajes nuevos del catálogo.
//
//   .addper3           →  cómo va la cosa
//   .addper3 1         →  agrega uno
//   .addper3 10        →  agrega diez, con 5 s entre cada uno
//   .addper3 reset     →  deshace la última tanda
//   .addper3 reset Goku→  quita ese y lo deja libre otra vez

import {
  disponibles, resumen, elegirAlAzar, precioDe, nombreDeTienda,
  porRenovar, cambiarImagen, animeDe, partirNombre,
  guardarEnRpg, quitarDelRpg, apuntarTanda, sacarUltimaTanda,
  olvidarDelHistorial, normName
} from "../../libs/catalogo.js";

import { fotoDePersonaje } from "../../libs/imagenanime.js";

const ESPERA_MS = 5000;   // entre personaje y personaje, para no hacer spam
const MAX_POR_VEZ = 100;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const bonito = (s) => String(s).replace(/_/g, " ");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = (sender || "").replace(/\D/g, "");
  const fromMe = !!msg.key.fromMe;
  const botID = (conn.user?.id || "").replace(/\D/g, "");

  await conn.sendMessage(chatId, { react: { text: "🛒", key: msg.key } }).catch(() => {});

  // Solo owners o el propio bot, igual que .addper
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  const primero = String(args[0] || "").toLowerCase();

  // ————————————————————————————————————————————————— reset
  if (primero === "reset") {
    const cual = args.slice(1).join(" ").trim();

    // .addper3 reset <nombre> → solo ese
    if (cual) {
      const quitados = quitarDelRpg([cual]);

      if (!quitados) {
        return conn.sendMessage(chatId, {
          text: `❓ No encontré a *${bonito(cual)}* en la tienda.`
        }, { quoted: msg });
      }

      olvidarDelHistorial(cual);

      await conn.sendMessage(chatId, { react: { text: "🗑️", key: msg.key } }).catch(() => {});
      return conn.sendMessage(chatId, {
        text:
`🗑️ *Quitado de la tienda*

⚔️ ${bonito(cual)}

Vuelve a estar disponible: si usas *.addper3* otra vez puede salir de nuevo, con otra imagen.`
      }, { quoted: msg });
    }

    // .addper3 reset → la última tanda entera
    const tanda = sacarUltimaTanda();

    if (!tanda || !tanda.personajes?.length) {
      return conn.sendMessage(chatId, {
        text: "❓ No hay ninguna tanda que deshacer."
      }, { quoted: msg });
    }

    const nombres = tanda.personajes.map((p) => p.nombre);
    const quitados = quitarDelRpg(nombres);

    await conn.sendMessage(chatId, { react: { text: "↩️", key: msg.key } }).catch(() => {});
    return conn.sendMessage(chatId, {
      text:
`↩️ *Última tanda deshecha*

🗑️ Quitados: *${quitados}*
${tanda.personajes.map((p) => `  • ${bonito(p.nombre)}`).join("\n")}

Todos vuelven a estar disponibles.`
    }, { quoted: msg });
  }

  // ————————————————————————————————————————————————— estado
  const r = resumen();

  if (!args.length) {
    return conn.sendMessage(chatId, {
      text:
`🎴 *ADDPER3* — agregar personajes solo

📚 En el catálogo: *${r.enCatalogo}* de *${r.animes}* animes
🏪 En la tienda: *${r.enRpg}*
♻️ Con foto del CDN viejo (van primero): *${r.porRenovar}*
🆕 Quedan por agregar: *${r.disponibles}*

✳️ Usa:
  *.addper3 1*      agrega uno
  *.addper3 10*     agrega diez
  *.addper3 reset*  deshace la última tanda
  *.addper3 reset <nombre>*  quita solo a ese

⏳ Entre uno y otro espera ${ESPERA_MS / 1000} s para no hacer spam.
Busca la foto en Pinterest, la sube al CDN y lo mete en la tienda con sus habilidades.`
    }, { quoted: msg });
  }

  // ————————————————————————————————————————————————— agregar
  const cuantos = parseInt(primero, 10);

  if (!Number.isFinite(cuantos) || cuantos < 1) {
    return conn.sendMessage(chatId, {
      text: `❌ Dime cuántos agregar. Ejemplo: *.addper3 5*`
    }, { quoted: msg });
  }

  if (cuantos > MAX_POR_VEZ) {
    return conn.sendMessage(chatId, {
      text: `❌ De golpe como mucho *${MAX_POR_VEZ}*. Serían ${Math.round(cuantos * ESPERA_MS / 1000 / 60)} minutos y es demasiado.`
    }, { quoted: msg });
  }

  // ————————————————————— primero, los de la tienda con la foto rota
  const viejos = porRenovar().slice(0, cuantos);
  const renovados = [];
  const puestos = [];
  const fallados = [];

  if (viejos.length) {
    await conn.sendMessage(chatId, {
      text:
`♻️ *Primero los que ya están en la tienda*

Hay *${r.porRenovar}* con la foto en el CDN viejo, que ya no funciona.
Ahora renuevo *${viejos.length}*: foto nueva, mismo precio y habilidades.
⏳ Unos ${Math.max(1, Math.round(viejos.length * (ESPERA_MS + 4000) / 1000 / 60))} minuto(s).`
    }, { quoted: msg });
  }

  for (let i = 0; i < viejos.length; i++) {
    const p = viejos[i];
    const [, limpio] = partirNombre(p.nombre);
    const anime = animeDe(p.nombre);
    const etiqueta = `(${i + 1}/${viejos.length})`;

    try {
      const { url } = await fotoDePersonaje(limpio, anime);
      const copias = cambiarImagen(p.imagen, url);

      renovados.push(limpio);

      await conn.sendMessage(chatId, {
        image: { url },
        caption:
`♻️ *Foto renovada* ${etiqueta}

⚔️ *Nombre:* ${bonito(limpio)}${anime ? `\n🎬 *Anime:* ${anime}` : ""}
💳 *Precio:* ${p.precio} créditos
☠️ *Habilidad 1:* ${bonito(p.habilidades?.[0]?.nombre || "-")}
🐉 *Habilidad 2:* ${bonito(p.habilidades?.[1]?.nombre || "-")}
🔁 Cambiada en ${copias} sitio(s) (tienda y usuarios)`
      }, { quoted: msg });
    } catch (e) {
      console.error(`[addper3] renovar ${limpio}:`, e?.message || e);
      fallados.push({ nombre: limpio, porque: e?.message || "error desconocido" });

      await conn.sendMessage(chatId, {
        text: `⚠️ ${etiqueta} *${bonito(limpio)}* no se pudo renovar: ${e?.message || "error"}`
      }, { quoted: msg });
    }

    if (i < viejos.length - 1 || cuantos > viejos.length) await dormir(ESPERA_MS);
  }

  // Lo que sobre de la cantidad pedida va a personajes nuevos del catálogo.
  const faltan = cuantos - viejos.length;
  if (faltan < 1) return terminar();

  const libres = disponibles();

  if (!libres.length) {
    if (viejos.length) return terminar();

    return conn.sendMessage(chatId, {
      text:
`🎉 *No queda ninguno por agregar*

Los *${r.enCatalogo}* del catálogo ya están en la tienda.
Para seguir, añade más a *catalogo-anime.json*.`
    }, { quoted: msg });
  }

  const elegidos = elegirAlAzar(Math.min(faltan, libres.length), libres);
  const minutos = Math.round(elegidos.length * (ESPERA_MS + 4000) / 1000 / 60);

  await conn.sendMessage(chatId, {
    text:
`🎴 *Agregando ${elegidos.length} personaje(s)*

⏳ Va a tardar unos ${minutos < 1 ? "menos de 1" : minutos} minuto(s).
🔎 Busco la foto, la subo al CDN y lo meto en la tienda.

_Si alguno no te gusta: *.addper3 reset*_`
  }, { quoted: msg });

  for (let i = 0; i < elegidos.length; i++) {
    const p = elegidos[i];
    const etiqueta = `(${i + 1}/${elegidos.length})`;

    try {
      const { url } = await fotoDePersonaje(p.nombre, p.anime);

      const personaje = {
        nombre: nombreDeTienda(p),
        imagen: url,
        precio: precioDe(p.rango),
        nivel: 1,
        habilidades: [
          { nombre: p.habilidades[0], nivel: 1 },
          { nombre: p.habilidades[1], nivel: 1 }
        ]
      };

      if (!guardarEnRpg(personaje)) {
        fallados.push({ nombre: p.nombre, porque: "ya estaba en la tienda" });
        continue;
      }

      puestos.push({ nombre: personaje.nombre, imagen: url, anime: p.anime });

      await conn.sendMessage(chatId, {
        image: { url },
        caption:
`✅ *Personaje agregado exitosamente a la tienda* ${etiqueta}

⚔️ *Nombre:* ${bonito(p.nombre)}
🎬 *Anime:* ${p.anime}
💳 *Precio:* ${personaje.precio} créditos
📈 *Nivel:* 1
☠️ *Habilidad 1:* ${bonito(p.habilidades[0])} (Nivel 1)
🐉 *Habilidad 2:* ${bonito(p.habilidades[1])} (Nivel 1)`
      }, { quoted: msg });

    } catch (e) {
      console.error(`[addper3] ${p.nombre}:`, e?.message || e);
      fallados.push({ nombre: p.nombre, porque: e?.message || "error desconocido" });

      await conn.sendMessage(chatId, {
        text: `⚠️ ${etiqueta} *${bonito(p.nombre)}* no se pudo agregar: ${e?.message || "error"}`
      }, { quoted: msg });
    }

    // La espera solo tiene sentido si queda alguno más
    if (i < elegidos.length - 1) await dormir(ESPERA_MS);
  }

  return terminar();

  // Los renovados no entran en la tanda: un reset los borraría de la tienda.
  async function terminar() {
    if (puestos.length) apuntarTanda(puestos, numero);

    const fin = resumen();
    const nuevos = puestos.length;

    await conn.sendMessage(chatId, {
      text:
`🎴 *Terminado*

${renovados.length ? `♻️ Fotos renovadas: *${renovados.length}*\n` : ""}✅ Agregados nuevos: *${nuevos}*
${fallados.length ? `⚠️ Fallaron: *${fallados.length}*\n${fallados.slice(0, 10).map((f) => `  • ${bonito(f.nombre)} — ${f.porque}`).join("\n")}\n` : ""}
🏪 La tienda tiene ahora *${fin.enRpg}* personajes
♻️ Quedan con foto vieja: *${fin.porRenovar}*
🆕 Quedan por agregar: *${fin.disponibles}*
${nuevos ? "\n_Para deshacer los nuevos: *.addper3 reset*_" : ""}`
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  }
};

handler.command = ["addper3"];
handler.help = ["addper3 <cantidad>", "addper3 reset"];
handler.tags = ["rpg"];

export default handler;
