// plugins/pluginsventas/Boletos.js — Boletos.
// Muestra lo que el grupo tenga guardado y se configura con setboletos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "boletos",
  comandos: ["boletos"],
  setComandos: ["setboletos"],
  titulo: "Boletos",
  emoji: "🎫"
});
