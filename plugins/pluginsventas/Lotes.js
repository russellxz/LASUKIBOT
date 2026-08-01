// plugins/pluginsventas/Lotes.js — Lotes.
// Los clientes lo ven con .lotes y los admins lo
// configuran con .setlotes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "lotes",
  comandos: ["lotes"],
  setComandos: ["setlotes"],
  titulo: "Lotes",
  emoji: "📦"
});
