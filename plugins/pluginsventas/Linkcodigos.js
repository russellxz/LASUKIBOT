// plugins/pluginsventas/Linkcodigos.js — Link de códigos.
// Muestra lo que el grupo tenga guardado y se configura con setlinkcodigos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "linkcodigos",
  comandos: ["linkcodigos"],
  setComandos: ["setlinkcodigos"],
  titulo: "Link de códigos",
  emoji: "🔗"
});
