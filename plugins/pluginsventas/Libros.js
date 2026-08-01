// plugins/pluginsventas/Libros.js — Libros.
// Muestra lo que el grupo tenga guardado y se configura con setlibros.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "libros",
  comandos: ["libros"],
  setComandos: ["setlibros"],
  titulo: "Libros",
  emoji: "📚"
});
