// plugins/pluginsventas/Vigencia.js — Vigencia.
// Muestra lo que el grupo tenga guardado y se configura con setvigencia.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "vigencia",
  comandos: ["vigencia"],
  setComandos: ["setvigencia"],
  titulo: "Vigencia",
  emoji: "⏳"
});
