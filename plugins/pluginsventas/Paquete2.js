// plugins/pluginsventas/Paquete2.js — Paquete 2.
// Muestra lo que el grupo tenga guardado y se configura con setpaquete2.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "paquete2",
  comandos: ["paquete2"],
  setComandos: ["setpaquete2"],
  titulo: "Paquete 2",
  emoji: "📦"
});
