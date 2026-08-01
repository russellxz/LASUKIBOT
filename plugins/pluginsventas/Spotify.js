// plugins/pluginsventas/Spotify.js — Spotify.
// Muestra lo que el grupo tenga guardado y se configura con setspotify.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "spotify",
  comandos: ["spotifyventa","spotifyv"],
  setComandos: ["setspotify"],
  titulo: "Spotify",
  emoji: "🎧"
});
