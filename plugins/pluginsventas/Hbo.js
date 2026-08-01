// plugins/pluginsventas/Hbo.js — HBO Max.
// Muestra lo que el grupo tenga guardado y se configura con sethbo.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "hbo",
  comandos: ["hbo"],
  setComandos: ["sethbo"],
  titulo: "HBO Max",
  emoji: "🎬"
});
