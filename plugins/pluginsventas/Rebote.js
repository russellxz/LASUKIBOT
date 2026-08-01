// plugins/pluginsventas/Rebote.js — Rebote.
// Muestra lo que el grupo tenga guardado y se configura con setrebote.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "rebote",
  comandos: ["rebote"],
  setComandos: ["setrebote"],
  titulo: "Rebote",
  emoji: "🔄"
});
