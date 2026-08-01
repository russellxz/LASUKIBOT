// plugins/pluginsventas/Numerovirtual.js — Número virtual.
// Muestra lo que el grupo tenga guardado y se configura con setnumerovirtual.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "numerovirtual",
  comandos: ["numerovirtual"],
  setComandos: ["setnumerovirtual"],
  titulo: "Número virtual",
  emoji: "📱"
});
