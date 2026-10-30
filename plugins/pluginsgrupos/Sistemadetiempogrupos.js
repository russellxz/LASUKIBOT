// plugins/checkTiempoGrupos.js
import fs from 'fs';
import path from 'path';
import { mediaBuffer } from '../../libs/media.js';

const OPEN_FILE  = path.resolve("tiempo_grupo.json");   // abrir
const CLOSE_FILE = path.resolve("tiempogrupo2.json");  // cerrar

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeJSON(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch {}
}
function emptyGroup(obj, key) {
  return obj[key] && Object.keys(obj[key]).length === 0;
}

async function applyAction(conn, chatId, action) {
  try {
    if (action === "close") {
      await conn.groupSettingUpdate(chatId, "announcement");
      await conn.sendMessage(chatId, {
        image: mediaBuffer("grupoCerrado"),
        caption: "🔒 El grupo ha sido cerrado automáticamente."
      });
    } else if (action === "open") {
      await conn.groupSettingUpdate(chatId, "not_announcement");
      await conn.sendMessage(chatId, {
        image: mediaBuffer("grupoAbierto"),
        caption: "🔓 El grupo ha sido abierto automáticamente."
      });
    }
  } catch (e) {
    // Si falla (por permisos, etc.), igual limpiamos el tiempo para no ciclar
    await conn.sendMessage(chatId, {
      text: `⚠️ No pude ${action === "close" ? "cerrar" : "abrir"} el grupo (quizá no soy admin). Se limpia la tarea programada.`
    }).catch(()=>{});
  }
}

const handler = async (conn) => {
  // Evita múltiples intervalos si se llama varias veces
  if (conn._tiemposInterval) return;

  conn._tiemposInterval = setInterval(async () => {
    const now = Date.now();

    // Cargar tiempos
    const abrirData  = readJSON(OPEN_FILE);
    const cerrarData = readJSON(CLOSE_FILE);

    // Unir todos los grupos que tengan algo pendiente
    const groups = new Set([
      ...Object.keys(abrirData || {}),
      ...Object.keys(cerrarData || {}),
    ]);

    let changedOpen = false;
    let changedClose = false;

    for (const chatId of groups) {
      try {
        const openTime  = abrirData?.[chatId]?.abrir  ?? null;
        const closeTime = cerrarData?.[chatId]?.cerrar ?? null;

        const dueOpen  = typeof openTime  === "number" && now >= openTime;
        const dueClose = typeof closeTime === "number" && now >= closeTime;

        if (!dueOpen && !dueClose) continue;

        // Si ambos vencieron, ejecuta el MÁS RECIENTE (mayor timestamp)
        let action;
        if (dueOpen && dueClose) {
          action = (closeTime >= openTime) ? "close" : "open";
        } else if (dueClose) {
          action = "close";
        } else {
          action = "open";
        }

        await applyAction(conn, chatId, action);

        // Limpiar tiempos ejecutados
        if (action === "open" && abrirData?.[chatId]?.abrir) {
          delete abrirData[chatId].abrir;
          if (emptyGroup(abrirData, chatId)) delete abrirData[chatId];
          changedOpen = true;
        }
        if (action === "close" && cerrarData?.[chatId]?.cerrar) {
          delete cerrarData[chatId].cerrar;
          if (emptyGroup(cerrarData, chatId)) delete cerrarData[chatId];
          changedClose = true;
        }

      } catch (err) {
        console.error("❌ Error procesando grupo", chatId, err?.message || err);
        // En caso de error inesperado, continuar con otros grupos
      }
    }

    // Persistir solo si hubo cambios
    if (changedOpen)  writeJSON(OPEN_FILE,  abrirData);
    if (changedClose) writeJSON(CLOSE_FILE, cerrarData);

  }, 10_000); // cada 10s
};

handler.run = handler;
export default handler;
