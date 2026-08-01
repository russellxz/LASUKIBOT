// plugins/pluginsventas/Peliculas.js — Películas.
// Los clientes lo ven con .peliculas y los admins lo
// configuran con .setpeliculas.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "peliculas",
  comandos: ["peliculas"],
  setComandos: ["setpeliculas"],
  titulo: "Películas",
  emoji: "🎥"
});
