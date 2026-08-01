// plugins/pluginsventas/Justificantes.js — Justificantes.
// Muestra lo que el grupo tenga guardado y se configura con setjustificantes.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "justificantes",
  comandos: ["justificantes"],
  setComandos: ["setjustificantes"],
  titulo: "Justificantes",
  emoji: "📝"
});
