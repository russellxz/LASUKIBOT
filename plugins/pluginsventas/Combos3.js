// plugins/pluginsventas/Combos3.js — Combos 3.
// Muestra lo que el grupo tenga guardado y se configura con setcombos3.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combos3",
  comandos: ["combos3"],
  setComandos: ["setcombos3"],
  titulo: "Combos 3",
  emoji: "🎁"
});
