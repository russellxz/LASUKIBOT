// plugins/pluginsventas/Imss.js — IMSS.
// Muestra lo que el grupo tenga guardado y se configura con setimss.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "imss",
  comandos: ["imss"],
  setComandos: ["setimss"],
  titulo: "IMSS",
  emoji: "🏥"
});
