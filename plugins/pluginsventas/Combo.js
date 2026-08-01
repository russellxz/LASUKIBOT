// plugins/pluginsventas/Combo.js — Combo.
// Muestra lo que el grupo tenga guardado y se configura con setcombo.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combo",
  comandos: ["combo"],
  setComandos: ["setcombo"],
  titulo: "Combo",
  emoji: "🎁"
});
