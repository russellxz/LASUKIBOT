// plugins/pluginsventas/Vix.js — ViX.
// Muestra lo que el grupo tenga guardado y se configura con setvix.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "vix",
  comandos: ["vix"],
  setComandos: ["setvix"],
  titulo: "ViX",
  emoji: "📺"
});
