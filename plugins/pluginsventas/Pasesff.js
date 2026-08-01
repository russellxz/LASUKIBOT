// plugins/pluginsventas/Pasesff.js — Pases FF.
// Muestra lo que el grupo tenga guardado y se configura con setpasesff.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pasesff",
  comandos: ["pasesff"],
  setComandos: ["setpasesff"],
  titulo: "Pases FF",
  emoji: "🎟️"
});
