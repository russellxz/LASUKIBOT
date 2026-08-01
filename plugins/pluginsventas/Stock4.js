// plugins/pluginsventas/Stock4.js — Stock 4.
// Muestra lo que el grupo tenga guardado y se configura con setstock4.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock4",
  comandos: ["stock4"],
  setComandos: ["setstock4"],
  titulo: "Stock 4",
  emoji: "📦"
});
