// plugins/pluginsventas/Combos2.js — Combos 2.
// Muestra lo que el grupo tenga guardado y se configura con setcombos2.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combos2",
  comandos: ["combos2"],
  setComandos: ["setcombos2"],
  titulo: "Combos 2",
  emoji: "🎁"
});
