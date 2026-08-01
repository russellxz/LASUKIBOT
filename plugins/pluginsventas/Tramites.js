// plugins/pluginsventas/Tramites.js — Trámites.
// Los clientes lo ven con .tramites y los admins lo
// configuran con .settramites.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "tramites",
  comandos: ["tramites"],
  setComandos: ["settramites"],
  titulo: "Trámites",
  emoji: "📄"
});
