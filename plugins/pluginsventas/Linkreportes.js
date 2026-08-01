// plugins/pluginsventas/Linkreportes.js — Link de reportes.
// Muestra lo que el grupo tenga guardado y se configura con setlinkreportes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "linkreportes",
  comandos: ["linkreportes"],
  setComandos: ["setlinkreportes"],
  titulo: "Link de reportes",
  emoji: "🔗"
});
