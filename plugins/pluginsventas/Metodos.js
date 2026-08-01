// plugins/pluginsventas/Metodos.js — Métodos.
// Muestra lo que el grupo tenga guardado y se configura con setmetodos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "metodos",
  comandos: ["metodos"],
  setComandos: ["setmetodos"],
  titulo: "Métodos",
  emoji: "🧠"
});
