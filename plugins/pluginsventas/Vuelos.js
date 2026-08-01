// plugins/pluginsventas/Vuelos.js — Vuelos.
// Muestra lo que el grupo tenga guardado y se configura con setvuelos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "vuelos",
  comandos: ["vuelos"],
  setComandos: ["setvuelos"],
  titulo: "Vuelos",
  emoji: "✈️"
});
