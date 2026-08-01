// plugins/pluginsventas/Fichareportes.js — Ficha de reportes.
// Muestra lo que el grupo tenga guardado y se configura con setfichareportes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "fichareportes",
  comandos: ["fichareportes"],
  setComandos: ["setfichareportes"],
  titulo: "Ficha de reportes",
  emoji: "🗂️"
});
