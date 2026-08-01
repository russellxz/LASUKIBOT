// plugins/pluginsventas/Paquete4.js — Paquete 4.
// Muestra lo que el grupo tenga guardado y se configura con setpaquete4.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "paquete4",
  comandos: ["paquete4"],
  setComandos: ["setpaquete4"],
  titulo: "Paquete 4",
  emoji: "📦"
});
