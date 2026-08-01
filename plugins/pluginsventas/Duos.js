// plugins/pluginsventas/Duos.js — Dúos.
// Los clientes lo ven con .duos y los admins lo
// configuran con .setduos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "duos",
  comandos: ["duos"],
  setComandos: ["setduos"],
  titulo: "Dúos",
  emoji: "👥"
});
