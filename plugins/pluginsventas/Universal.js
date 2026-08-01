// plugins/pluginsventas/Universal.js — Universal.
// Muestra lo que el grupo tenga guardado y se configura con setuniversal.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "universal",
  comandos: ["universal"],
  setComandos: ["setuniversal"],
  titulo: "Universal",
  emoji: "🌐"
});
