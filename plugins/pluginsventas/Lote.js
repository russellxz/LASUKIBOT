// plugins/pluginsventas/Lote.js — Lote.
// Muestra lo que el grupo tenga guardado y se configura con setlote.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "lote",
  comandos: ["lote"],
  setComandos: ["setlote"],
  titulo: "Lote",
  emoji: "📦"
});
