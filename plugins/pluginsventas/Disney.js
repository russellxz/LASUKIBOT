// plugins/pluginsventas/Disney.js — Disney+.
// Muestra lo que el grupo tenga guardado y se configura con setdisney.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "disney",
  comandos: ["disney"],
  setComandos: ["setdisney"],
  titulo: "Disney+",
  emoji: "🏰"
});
