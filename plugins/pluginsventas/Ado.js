// plugins/pluginsventas/Ado.js — ADO.
// Muestra lo que el grupo tenga guardado y se configura con setado.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "ado",
  comandos: ["ado"],
  setComandos: ["setado"],
  titulo: "ADO",
  emoji: "🚌"
});
