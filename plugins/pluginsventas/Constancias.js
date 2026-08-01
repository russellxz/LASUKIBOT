// plugins/pluginsventas/Constancias.js — Constancias.
// Muestra lo que el grupo tenga guardado y se configura con setconstancias.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "constancias",
  comandos: ["constancias"],
  setComandos: ["setconstancias"],
  titulo: "Constancias",
  emoji: "📄"
});
