// plugins/pluginsventas/Actas.js — Actas.
// Muestra lo que el grupo tenga guardado y se configura con setactas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "actas",
  comandos: ["actas"],
  setComandos: ["setactas"],
  titulo: "Actas",
  emoji: "📜"
});
