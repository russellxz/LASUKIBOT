// plugins/pluginsventas/Stock2.js — Stock 2.
// Los clientes lo ven con .stock2 y los admins lo
// configuran con .setstock2.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock2",
  comandos: ["stock2"],
  setComandos: ["setstock2"],
  titulo: "Stock 2",
  emoji: "📦"
});
