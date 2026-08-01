// plugins/pluginsventas/Stock9.js — Stock 9.
// Muestra lo que el grupo tenga guardado y se configura con setstock9.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock9",
  comandos: ["stock9"],
  setComandos: ["setstock9"],
  titulo: "Stock 9",
  emoji: "📦"
});
