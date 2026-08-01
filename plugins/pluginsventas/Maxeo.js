// plugins/pluginsventas/Maxeo.js — Maxeo.
// Muestra lo que el grupo tenga guardado y se configura con setmaxeo.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "maxeo",
  comandos: ["maxeo"],
  setComandos: ["setmaxeo"],
  titulo: "Maxeo",
  emoji: "🚀"
});
