// plugins/pluginsventas/Recargas.js — Recargas.
// Muestra lo que el grupo tenga guardado y se configura con setrecargas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "recargas",
  comandos: ["recargas"],
  setComandos: ["setrecargas"],
  titulo: "Recargas",
  emoji: "📲"
});
