// plugins/pluginsventas/Programas.js — Programas.
// Muestra lo que el grupo tenga guardado y se configura con setprogramas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "programas",
  comandos: ["programas"],
  setComandos: ["setprogramas"],
  titulo: "Programas",
  emoji: "💻"
});
