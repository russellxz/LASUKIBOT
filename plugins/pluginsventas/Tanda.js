// plugins/pluginsventas/Tanda.js — Tanda.
// Muestra lo que el grupo tenga guardado y se configura con settanda.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "tanda",
  comandos: ["tanda"],
  setComandos: ["settanda"],
  titulo: "Tanda",
  emoji: "💰"
});
