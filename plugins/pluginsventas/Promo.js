// plugins/pluginsventas/Promo.js — Promo.
// Los clientes lo ven con .promo y los admins lo
// configuran con .setpromo.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "promo",
  comandos: ["promo"],
  setComandos: ["setpromo"],
  titulo: "Promo",
  emoji: "🔥"
});
