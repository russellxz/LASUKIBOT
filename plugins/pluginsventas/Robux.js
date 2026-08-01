// plugins/pluginsventas/Robux.js — Robux.
// Muestra lo que el grupo tenga guardado y se configura con setrobux.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "robux",
  comandos: ["robux"],
  setComandos: ["setrobux"],
  titulo: "Robux",
  emoji: "🟩"
});
