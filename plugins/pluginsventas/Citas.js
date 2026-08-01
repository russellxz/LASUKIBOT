// plugins/pluginsventas/Citas.js — Citas.
// Muestra lo que el grupo tenga guardado y se configura con setcitas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "citas",
  comandos: ["citas"],
  setComandos: ["setcitas"],
  titulo: "Citas",
  emoji: "📅"
});
