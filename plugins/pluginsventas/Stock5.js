// plugins/pluginsventas/Stock5.js — Stock 5.
// Muestra lo que el grupo tenga guardado y se configura con setstock5.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock5",
  comandos: ["stock5"],
  setComandos: ["setstock5"],
  titulo: "Stock 5",
  emoji: "📦"
});
