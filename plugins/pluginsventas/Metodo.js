// plugins/pluginsventas/Metodo.js — Método.
// Muestra lo que el grupo tenga guardado y se configura con setmetodo.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "metodo",
  comandos: ["metodo"],
  setComandos: ["setmetodo"],
  titulo: "Método",
  emoji: "🧠"
});
