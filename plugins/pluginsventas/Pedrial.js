// plugins/pluginsventas/Pedrial.js — Pedrial.
// Muestra lo que el grupo tenga guardado y se configura con setpedrial.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pedrial",
  comandos: ["pedrial"],
  setComandos: ["setpedrial"],
  titulo: "Pedrial",
  emoji: "🛍️"
});
