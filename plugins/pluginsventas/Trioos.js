// plugins/pluginsventas/Trioos.js — Tríos.
// Los clientes lo ven con .trios y los admins lo
// configuran con .settrios.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "trios",
  comandos: ["trios"],
  setComandos: ["settrios"],
  titulo: "Tríos",
  emoji: "👨‍👩‍👦"
});
