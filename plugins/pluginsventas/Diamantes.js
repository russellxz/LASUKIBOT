// plugins/pluginsventas/Diamantes.js — Diamantes.
// Los clientes lo ven con .diamantes y los admins lo
// configuran con .setdiamantes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "diamantes",
  comandos: ["diamantes"],
  setComandos: ["setdiamantes"],
  titulo: "Diamantes",
  emoji: "💎"
});
