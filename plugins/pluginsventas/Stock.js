// plugins/pluginsventas/Stock.js — Stock.
// Los clientes lo ven con .stock y los admins lo
// configuran con .setstock.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock",
  comandos: ["stock"],
  setComandos: ["setstock"],
  titulo: "Stock",
  emoji: "📦"
});
