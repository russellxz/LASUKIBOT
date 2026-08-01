// plugins/pluginsventas/Pago.js — Pago.
// Los clientes lo ven con .pago y los admins lo
// configuran con .setpago.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pago",
  comandos: ["pago"],
  setComandos: ["setpago"],
  titulo: "Pago",
  emoji: "💳"
});
