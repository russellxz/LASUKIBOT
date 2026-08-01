// plugins/pluginsventas/Combos4.js — Combos 4.
// Muestra lo que el grupo tenga guardado y se configura con setcombos4.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combos4",
  comandos: ["combos4"],
  setComandos: ["setcombos4"],
  titulo: "Combos 4",
  emoji: "🎁"
});
