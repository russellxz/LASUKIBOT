// plugins/pluginsventas/Codigos.js — Códigos.
// Muestra lo que el grupo tenga guardado y se configura con setcodigos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "codigos",
  comandos: ["codigos"],
  setComandos: ["setcodigos"],
  titulo: "Códigos",
  emoji: "🔑"
});
