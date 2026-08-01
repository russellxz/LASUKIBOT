// plugins/pluginsventas/Adicionales.js — Adicionales.
// Muestra lo que el grupo tenga guardado y se configura con setadicionales.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "adicionales",
  comandos: ["adicionales"],
  setComandos: ["setadicionales"],
  titulo: "Adicionales",
  emoji: "➕"
});
