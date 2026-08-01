// plugins/pluginsventas/Dinamica.js — Dinámica.
// Muestra lo que el grupo tenga guardado y se configura con setdinamica.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "dinamica",
  comandos: ["dinamica"],
  setComandos: ["setdinamica"],
  titulo: "Dinámica",
  emoji: "🎲"
});
