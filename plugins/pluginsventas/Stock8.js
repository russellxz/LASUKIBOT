// plugins/pluginsventas/Stock8.js — Stock 8.
// Muestra lo que el grupo tenga guardado y se configura con setstock8.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock8",
  comandos: ["stock8"],
  setComandos: ["setstock8"],
  titulo: "Stock 8",
  emoji: "📦"
});
