// plugins/pluginsventas/Fragmentos.js — Fragmentos.
// Muestra lo que el grupo tenga guardado y se configura con setfragmentos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "fragmentos",
  comandos: ["fragmentos"],
  setComandos: ["setfragmentos"],
  titulo: "Fragmentos",
  emoji: "💠"
});
