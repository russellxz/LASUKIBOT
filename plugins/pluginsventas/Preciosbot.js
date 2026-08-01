// plugins/pluginsventas/Preciosbot.js — Precios del bot.
// Muestra lo que el grupo tenga guardado y se configura con setpreciosbot.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "preciosbot",
  comandos: ["preciosbot"],
  setComandos: ["setpreciosbot"],
  titulo: "Precios del bot",
  emoji: "🤖"
});
