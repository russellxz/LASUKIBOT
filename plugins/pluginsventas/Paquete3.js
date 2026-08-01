// plugins/pluginsventas/Paquete3.js — Paquete 3.
// Muestra lo que el grupo tenga guardado y se configura con setpaquete3.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "paquete3",
  comandos: ["paquete3"],
  setComandos: ["setpaquete3"],
  titulo: "Paquete 3",
  emoji: "📦"
});
