// plugins/pluginsventas/Soporte.js — Soporte.
// Los clientes lo ven con .soporte y los admins lo
// configuran con .setsoporte.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "soporte",
  comandos: ["soporte"],
  setComandos: ["setsoporte"],
  titulo: "Soporte",
  emoji: "🛟"
});
