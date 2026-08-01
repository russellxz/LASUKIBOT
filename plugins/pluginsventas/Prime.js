// plugins/pluginsventas/Prime.js — Prime Video.
// Muestra lo que el grupo tenga guardado y se configura con setprime.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "prime",
  comandos: ["prime"],
  setComandos: ["setprime"],
  titulo: "Prime Video",
  emoji: "📺"
});
