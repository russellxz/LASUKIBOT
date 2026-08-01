// plugins/pluginsventas/Rfc.js — RFC.
// Muestra lo que el grupo tenga guardado y se configura con setrfc.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "rfc",
  comandos: ["rfc"],
  setComandos: ["setrfc"],
  titulo: "RFC",
  emoji: "🆔"
});
