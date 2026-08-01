// plugins/pluginsventas/Facturas.js — Facturas.
// Muestra lo que el grupo tenga guardado y se configura con setfacturas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "facturas",
  comandos: ["facturas"],
  setComandos: ["setfacturas"],
  titulo: "Facturas",
  emoji: "🧾"
});
