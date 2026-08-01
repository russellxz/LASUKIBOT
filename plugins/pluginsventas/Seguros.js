// plugins/pluginsventas/Seguros.js — Seguros.
// Muestra lo que el grupo tenga guardado y se configura con setseguros.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "seguros",
  comandos: ["seguros"],
  setComandos: ["setseguros"],
  titulo: "Seguros",
  emoji: "🛡️"
});
