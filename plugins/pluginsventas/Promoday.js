// plugins/pluginsventas/Promoday.js — Promo del día.
// Muestra lo que el grupo tenga guardado y se configura con setpromoday.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "promoday",
  comandos: ["promoday"],
  setComandos: ["setpromoday"],
  titulo: "Promo del día",
  emoji: "🔥"
});
