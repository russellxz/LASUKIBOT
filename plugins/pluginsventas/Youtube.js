// plugins/pluginsventas/Youtube.js — YouTube Premium.
// Muestra lo que el grupo tenga guardado y se configura con setyoutube.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "youtube",
  comandos: ["youtube"],
  setComandos: ["setyoutube"],
  titulo: "YouTube Premium",
  emoji: "▶️"
});
