// plugins/pluginsventas/Stock7.js — Stock 7.
// Muestra lo que el grupo tenga guardado y se configura con setstock7.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock7",
  comandos: ["stock7"],
  setComandos: ["setstock7"],
  titulo: "Stock 7",
  emoji: "📦"
});
