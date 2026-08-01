// plugins/pluginsventas/Pago2.js — Pago 2.
// Muestra lo que el grupo tenga guardado y se configura con setpago2.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "pago2",
  comandos: ["pago2"],
  setComandos: ["setpago2"],
  titulo: "Pago 2",
  emoji: "💳"
});
