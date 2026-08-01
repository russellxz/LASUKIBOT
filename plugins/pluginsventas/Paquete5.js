// plugins/pluginsventas/Paquete5.js — Paquete 5.
// Muestra lo que el grupo tenga guardado y se configura con setpaquete5.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "paquete5",
  comandos: ["paquete5"],
  setComandos: ["setpaquete5"],
  titulo: "Paquete 5",
  emoji: "📦"
});
