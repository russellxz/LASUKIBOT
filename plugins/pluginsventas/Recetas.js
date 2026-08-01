// plugins/pluginsventas/Recetas.js — Recetas.
// Muestra lo que el grupo tenga guardado y se configura con setrecetas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "recetas",
  comandos: ["recetas"],
  setComandos: ["setrecetas"],
  titulo: "Recetas",
  emoji: "🍽️"
});
