// plugins/pluginsventas/Universidad.js — Universidad.
// Muestra lo que el grupo tenga guardado y se configura con setuniversidad.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "universidad",
  comandos: ["universidad"],
  setComandos: ["setuniversidad"],
  titulo: "Universidad",
  emoji: "🎓"
});
