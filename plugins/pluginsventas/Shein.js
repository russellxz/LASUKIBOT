// plugins/pluginsventas/Shein.js — Shein.
// Muestra lo que el grupo tenga guardado y se configura con setshein.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "shein",
  comandos: ["shein"],
  setComandos: ["setshein"],
  titulo: "Shein",
  emoji: "👗"
});
