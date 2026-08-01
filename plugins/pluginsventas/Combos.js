// plugins/pluginsventas/Combos.js — Combos.
// Los clientes lo ven con .combos y los admins lo
// configuran con .setcombos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "combos",
  comandos: ["combos"],
  setComandos: ["setcombos"],
  titulo: "Combos",
  emoji: "🎁"
});
