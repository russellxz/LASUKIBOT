// plugins/pluginsventas/Pago4.js — Pago 4.
// Muestra lo que el grupo tenga guardado y se configura con setpago4.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pago4",
  comandos: ["pago4"],
  setComandos: ["setpago4"],
  titulo: "Pago 4",
  emoji: "💳"
});
