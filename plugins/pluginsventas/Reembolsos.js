// plugins/pluginsventas/Reembolsos.js — Reembolsos.
// Muestra lo que el grupo tenga guardado y se configura con setreembolsos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "reembolsos",
  comandos: ["reembolsos"],
  setComandos: ["setreembolsos"],
  titulo: "Reembolsos",
  emoji: "💸"
});
