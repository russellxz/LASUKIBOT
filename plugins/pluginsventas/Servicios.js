// plugins/pluginsventas/Servicios.js — Servicios.
// Muestra lo que el grupo tenga guardado y se configura con setservicios.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "servicios",
  comandos: ["servicios"],
  setComandos: ["setservicios"],
  titulo: "Servicios",
  emoji: "🛠️"
});
