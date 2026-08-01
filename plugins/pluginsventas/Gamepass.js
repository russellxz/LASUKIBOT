// plugins/pluginsventas/Gamepass.js — Game Pass.
// Muestra lo que el grupo tenga guardado y se configura con setgamepass.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "gamepass",
  comandos: ["gamepass"],
  setComandos: ["setgamepass"],
  titulo: "Game Pass",
  emoji: "🎮"
});
