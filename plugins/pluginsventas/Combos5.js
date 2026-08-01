// plugins/pluginsventas/Combos5.js — Combos 5.
// Muestra lo que el grupo tenga guardado y se configura con setcombos5.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combos5",
  comandos: ["combos5"],
  setComandos: ["setcombos5"],
  titulo: "Combos 5",
  emoji: "🎁"
});
