// plugins/pluginsventas/Autobus.js — Autobús.
// Muestra lo que el grupo tenga guardado y se configura con setautobus.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "autobus",
  comandos: ["autobus"],
  setComandos: ["setautobus"],
  titulo: "Autobús",
  emoji: "🚍"
});
