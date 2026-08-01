// plugins/pluginsventas/Stock6.js — Stock 6.
// Muestra lo que el grupo tenga guardado y se configura con setstock6.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock6",
  comandos: ["stock6"],
  setComandos: ["setstock6"],
  titulo: "Stock 6",
  emoji: "📦"
});
