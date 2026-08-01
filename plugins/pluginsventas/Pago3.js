// plugins/pluginsventas/Pago3.js — Pago 3.
// Muestra lo que el grupo tenga guardado y se configura con setpago3.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pago3",
  comandos: ["pago3"],
  setComandos: ["setpago3"],
  titulo: "Pago 3",
  emoji: "💳"
});
