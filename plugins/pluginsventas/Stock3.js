// plugins/pluginsventas/Stock3.js — Stock 3.
// Los clientes lo ven con .stock3 y los admins lo
// configuran con .setstock3.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "stock3",
  comandos: ["stock3"],
  setComandos: ["setstock3"],
  titulo: "Stock 3",
  emoji: "📦"
});
