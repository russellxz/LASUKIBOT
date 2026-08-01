// plugins/pluginsventas/Netflix.js — Netflix.
// Los clientes lo ven con .netflix y los admins lo
// configuran con .setnetflix.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "netflix",
  comandos: ["netflix"],
  setComandos: ["setnetflix"],
  titulo: "Netflix",
  emoji: "🎬"
});
