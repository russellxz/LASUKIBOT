// plugins/pluginsventas/Descuentos.js — Descuentos.
// Muestra lo que el grupo tenga guardado y se configura con setdescuentos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "descuentos",
  comandos: ["descuentos"],
  setComandos: ["setdescuentos"],
  titulo: "Descuentos",
  emoji: "🏷️"
});
