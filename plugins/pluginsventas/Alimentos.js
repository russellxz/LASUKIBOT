// plugins/pluginsventas/Alimentos.js — Alimentos.
// Muestra lo que el grupo tenga guardado y se configura con setalimentos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "alimentos",
  comandos: ["alimentos"],
  setComandos: ["setalimentos"],
  titulo: "Alimentos",
  emoji: "🍔"
});
