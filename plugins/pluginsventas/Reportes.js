// plugins/pluginsventas/Reportes.js — Reportes.
// Muestra lo que el grupo tenga guardado y se configura con setreportes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "reportes",
  comandos: ["reportes"],
  setComandos: ["setreportes"],
  titulo: "Reportes",
  emoji: "📊"
});
