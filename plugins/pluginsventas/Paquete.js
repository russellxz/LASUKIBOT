// plugins/pluginsventas/Paquete.js — Paquete.
// Muestra lo que el grupo tenga guardado y se configura con setpaquete.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "paquete",
  comandos: ["paquete"],
  setComandos: ["setpaquete"],
  titulo: "Paquete",
  emoji: "📦"
});
