// plugins/pluginsventas/Pago5.js — Pago 5.
// Muestra lo que el grupo tenga guardado y se configura con setpago5.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pago5",
  comandos: ["pago5"],
  setComandos: ["setpago5"],
  titulo: "Pago 5",
  emoji: "💳"
});
