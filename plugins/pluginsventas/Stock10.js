// plugins/pluginsventas/Stock10.js — Stock 10.
// Muestra lo que el grupo tenga guardado y se configura con setstock10.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock10",
  comandos: ["stock10"],
  setComandos: ["setstock10"],
  titulo: "Stock 10",
  emoji: "📦"
});
