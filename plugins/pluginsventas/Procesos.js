// plugins/pluginsventas/Procesos.js — Procesos.
// Muestra lo que el grupo tenga guardado y se configura con setprocesos.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "procesos",
  comandos: ["procesos"],
  setComandos: ["setprocesos"],
  titulo: "Procesos",
  emoji: "⚙️"
});
