// plugins/pluginsventas/Canvas.js — Canvas.
// Los clientes lo ven con .canvas / .canva y los admins lo
// configuran con .setcanvas / .setcanva.
import { crearVenta } from "../../ventas-core.js";

export default crearVenta({
  clave: "canvas",
  comandos: ["canvas","canva"],
  setComandos: ["setcanvas","setcanva"],
  titulo: "Canvas",
  emoji: "🖼️"
});
