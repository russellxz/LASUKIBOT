// plugins/pluginsventas/Certificados.js — Certificados.
// Muestra lo que el grupo tenga guardado y se configura con setcertificados.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "certificados",
  comandos: ["certificados"],
  setComandos: ["setcertificados"],
  titulo: "Certificados",
  emoji: "🏅"
});
