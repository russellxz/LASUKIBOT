// libs/media.js — Imágenes propias del bot, guardadas en la carpeta ./media
//
// Antes los menús, verdad/reto, bienvenidas, abrir/cerrar grupo y el RPG usaban
// URLs de un CDN externo; si el CDN se caía, el mensaje no salía. Ahora las
// imágenes vienen dentro del bot y se mandan directamente desde el disco.
// Lo usan tanto el bot principal como los subbots.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Anclado a la carpeta del bot (no al directorio de trabajo)
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MEDIA_DIR = path.join(RAIZ, "media");

export const MEDIA = {
  menu: "menu.jpg",
  menugrupo: "menugrupo.jpg",
  menuowner: "menuowner.jpg",
  menuaudio: "menuaudio.jpg",
  menufree: "menufree.jpg",
  menurpg: "menurpg.jpg",
  menuventas: "menuventas.jpg",
  allmenu: "allmenu.jpg",
  info: "info.jpg",
  verdad: "verdad.jpg",
  reto: "reto.jpg",
  bienvenida: "bienvenida.jpg",
  despedida: "despedida.jpg",
  grupoAbierto: "grupo-abierto.jpg",
  grupoCerrado: "grupo-cerrado.jpg",
  invocar: "invocar.jpg",

  // RPG
  mundorpg: "mundorpg.jpg",
  saldo: "saldo.jpg",
  nivel: "nivel.jpg",
  tuspersonajes: "tuspersonajes.jpg",
  tiendaper: "tiendaper.jpg",
  mercado: "mercado.jpg",
  banco: "banco.jpg",
  tiendabank: "tiendabank.jpg",
  topper: "topper.jpg",
  topuser: "topuser.jpg",
  topmascotas: "topmascotas.jpg",
  topmillo: "topmillo.jpg",
  gremio: "gremio.jpg",
  clansupremo: "clansupremo.jpg",
  topesclavos: "topesclavos.jpg",
  tiendaesclavos: "tiendaesclavos.jpg"
};

/** Ruta absoluta de una imagen (sirve para canvas loadImage o { url }) */
export function mediaPath(clave) {
  const archivo = MEDIA[clave];
  if (!archivo) throw new Error(`[media] Imagen desconocida: ${clave}`);
  return path.join(MEDIA_DIR, archivo);
}

/** Buffer listo para sendMessage: { image: mediaBuffer("verdad") } */
export function mediaBuffer(clave) {
  return fs.readFileSync(mediaPath(clave));
}
