// plugins/pluginsventas/Seguidores.js — Seguidores.
// Los clientes lo ven con .seguidores y los admins lo
// configuran con .setseguidores.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "seguidores",
  comandos: ["seguidores"],
  setComandos: ["setseguidores"],
  titulo: "Seguidores",
  emoji: "📈"
});
