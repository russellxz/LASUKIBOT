let canalId = ["120363266665814365@newsletter"];  
let canalNombre = ["👑 LA SUKI BOT 👑"]
  function setupConnection(conn) {
  conn.sendMessage2 = async (chat, content, m, options = {}) => {
    const firstChannel = { 
      id: canalId[0], 
      nombre: canalNombre[0] 
    };
    if (content.sticker) {
      return conn.sendMessage(chat, { 
        sticker: content.sticker 
      }, { 
        quoted: m,
        ...options 
      });
    }
    const messageOptions = {
      ...content,
      mentions: content.mentions || options.mentions || [],
      contextInfo: {
        ...(content.contextInfo || {}),
        forwardedNewsletterMessageInfo: {
          newsletterJid: firstChannel.id,
          serverMessageId: '',
          newsletterName: firstChannel.nombre
        },
        forwardingScore: 9999999,
        isForwarded: true,
        mentionedJid: content.mentions || options.mentions || []
      }
    };

    return conn.sendMessage(chat, messageOptions, {
      quoted: m,
      ephemeralExpiration: 86400000,
      disappearingMessagesInChat: 86400000,
      ...options
    });
  };
  }



// (sin los require de Baileys aquí)
import fs, { readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";
import figlet from "figlet";
import readline from "readline";
import pino from "pino";
import axios from "axios";
import { setConfig, getConfig, getAntideleteDB, saveAntideleteDB } from "./db.js";
import { startWebServer } from "./webserver.js";
import "./config.js";

// 🌐 Prefijos personalizados desde prefijos.json o por defecto
let defaultPrefixes = [".", "#"];
const prefixPath = "./prefijos.json";
if (fs.existsSync(prefixPath)) {
  try {
    const contenido = fs.readFileSync(prefixPath, "utf-8").trim();
    const parsed = JSON.parse(contenido);
    if (Array.isArray(parsed)) {
      defaultPrefixes = parsed;
    } else if (typeof parsed === "string") {
      defaultPrefixes = [parsed];
    }
  } catch {}
}
global.prefixes = defaultPrefixes;

// 🧑‍💼 Owners desde owner.json
const ownerPath = "./owner.json";
if (!fs.existsSync(ownerPath)) fs.writeFileSync(ownerPath, JSON.stringify([["15167096032"]], null, 2));
global.owner = JSON.parse(fs.readFileSync(ownerPath));

// 📂 Cargar plugins
const loadPluginsRecursively = async (dir) => {
  if (!fs.existsSync(dir)) return;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      await loadPluginsRecursively(fullPath); // Recurse en subcarpetas
    } else if (item.isFile() && item.name.endsWith(".js")) {
      try {
        const mod = await import(pathToFileURL(path.resolve(fullPath)).href);
        const plugin = mod.default || mod;
        global.plugins.push(plugin);
        console.log(chalk.green(`✅ Plugin cargado: ${fullPath}`));
      } catch (err) {
        console.log(chalk.red(`❌ Error al cargar ${fullPath}: ${err}`));
      }
    }
  }
};

// 👉 Cargar todos los .js dentro de ./plugins y subcarpetas
global.plugins = [];
await loadPluginsRecursively("./plugins");

// ⚡ Índice comando → plugin para despacho O(1) (antes recorría TODOS los
// plugins en cada mensaje). El primero que registra un comando gana, igual
// que el orden del recorrido clásico.
global.buildPluginIndex = function () {
  const index = new Map();
  for (const plugin of global.plugins) {
    const cmds = Array.isArray(plugin?.command) ? plugin.command : [];
    for (const c of cmds) {
      const key = String(c).toLowerCase();
      if (!index.has(key)) index.set(key, plugin);
    }
  }
  global.pluginIndex = index;
  return index;
};
global.buildPluginIndex();

// 🎯 Función global para verificar si es owner
global.isOwner = function (jid) {
  const num = jid.replace(/[^0-9]/g, "");
  return global.owner.some(([id]) => id === num);
};

// 🤖 SISTEMA DE SUBBOTS (independiente del bot principal)
// Corre por separado: si el bot principal se cae o entra en soporte,
// los subbots ya conectados siguen funcionando y se auto-reconectan.
import("./subbots.js")
  .then((sub) => sub.initSubbots())
  .catch((e) => console.error("❌ Error iniciando sistema de subbots:", e));

// 🎨 Banner y opciones
console.log(chalk.cyan(figlet.textSync("Suki 3.0 Bot", { font: "Standard" })));
console.log(chalk.green("\n✅ Iniciando conexión...\n"));
console.log(chalk.green("  [Hola] ") + chalk.white("🔑 Ingresar Tu Numero(Ej: 54911XXXXXX)\n"));

// 📞 Entrada de usuario
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let method = "1";
let phoneNumber = "";

(async () => {
  // ✅ Import dinámico compatible con CJS (6.x) y ESM (futuro 7.x)
  const mod = await import('@whiskeysockets/baileys');
  // Si es CJS, `mod.default` es el objeto de exports; si es ESM, usamos `mod` directo
  const B = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestWaWebVersion,    // puede existir solo en versiones nuevas
    fetchLatestBaileysVersion,  // existe en 6.x
    downloadContentFromMessage
  } = B;

  // Función de versión compatible (usa la nueva si existe; si no, la vieja)
  const getWaVersion = typeof fetchLatestWaWebVersion === "function"
    ? fetchLatestWaWebVersion
    : fetchLatestBaileysVersion;

  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  if (!fs.existsSync("./sessions/creds.json")) {
    method = await question(chalk.magenta("📞(VAMOS AYA😎): "));
    phoneNumber = method.replace(/\D/g, "");
    if (!phoneNumber) {
      console.log(chalk.red("\n❌ Número inválido."));
      process.exit(1);
    }
    method = "2";
  }

  async function startBot() {
    try {
      // ✅ usa la función de versión disponible en tu Baileys
      const { version } = await getWaVersion();

      // 🚀 Caché de metadata de grupos: evita que Baileys consulte la
      // metadata del grupo en CADA envío (gran parte de la latencia en grupos).
      global.groupMetaCache = global.groupMetaCache || new Map();
      const metaCache = global.groupMetaCache;

      // 🚀 Caché de listas de dispositivos (compartida con los subbots).
      // El default de Baileys expira cada 5 min y cada expiración cuesta una
      // consulta de red (~100ms) en el siguiente envío. Es seguro alargarla:
      // Baileys la invalida solo cuando WhatsApp notifica cambios de
      // dispositivos del usuario.
      if (!global.__deviceListCache) {
        const dlStore = new Map();
        const DL_TTL = 60 * 60 * 1000; // 1 hora
        global.__deviceListCache = {
          get(k) {
            const e = dlStore.get(k);
            if (!e) return undefined;
            if (Date.now() > e.exp) { dlStore.delete(k); return undefined; }
            return e.v;
          },
          set(k, v) {
            dlStore.set(k, { v, exp: Date.now() + DL_TTL });
            if (dlStore.size > 10000) dlStore.delete(dlStore.keys().next().value);
          },
          mget(keys) {
            const out = {};
            for (const k of keys || []) {
              const v = this.get(k);
              if (v !== undefined) out[k] = v;
            }
            return out;
          },
          mset(entries) {
            for (const { key, value } of entries || []) this.set(key, value);
          },
          del(k) { dlStore.delete(k); },
          flushAll() { dlStore.clear(); }
        };
      }

      const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        browser: method === "1" ? ["AzuraBot", "Safari", "1.0.0"] : ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: method === "1",
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        cachedGroupMetadata: async (jid) => {
          const hit = metaCache.get(jid);
          return hit && Date.now() - hit.ts < 60000 ? hit.meta : undefined;
        },
        userDevicesCache: global.__deviceListCache,
      });

      // Cada consulta de metadata (nuestra o de un plugin) alimenta el caché
      const __origGroupMetadata = sock.groupMetadata.bind(sock);
      sock.groupMetadata = async (jid, ...rest) => {
        const meta = await __origGroupMetadata(jid, ...rest);
        if (meta && typeof jid === "string" && jid.endsWith("@g.us")) {
          metaCache.set(jid, { meta, ts: Date.now() });
          if (metaCache.size > 500) {
            const first = metaCache.keys().next().value;
            metaCache.delete(first);
          }
        }
        return meta;
      };

      // 🔥 Precalienta dispositivos y sesiones de cifrado de los miembros de
      // un grupo en segundo plano. En grupos grandes el envío pagaba pedir
      // los dispositivos/sesiones de cada miembro (~360ms en grupos llenos
      // vs ~15ms en chicos). Con esto, al responder ya está todo listo.
      sock.__prewarmTs = new Map();
      sock.__prewarmGroup = async (chatId) => {
        try {
          const last = sock.__prewarmTs.get(chatId) || 0;
          if (Date.now() - last < 10 * 60 * 1000) return; // 1 vez cada 10 min
          sock.__prewarmTs.set(chatId, Date.now());
          if (sock.__prewarmTs.size > 300) {
            const first = sock.__prewarmTs.keys().next().value;
            sock.__prewarmTs.delete(first);
          }

          const hit = metaCache.get(chatId);
          const meta = (hit && Date.now() - hit.ts < 60000 ? hit.meta : null) ||
            (await sock.groupMetadata(chatId).catch(() => null));

          const jids = (meta?.participants || [])
            .map((p) => (typeof p?.jid === "string" && p.jid) || (typeof p?.id === "string" && p.id) || null)
            .filter(Boolean);
          if (!jids.length) return;

          if (typeof sock.getUSyncDevices === "function") {
            const devices = await sock.getUSyncDevices(jids, true, false);
            const deviceJids = (devices || []).map((d) => d?.jid).filter(Boolean);

            // assertSessions sin force solo pide las sesiones que faltan
            if (deviceJids.length && typeof sock.assertSessions === "function") {
              await sock.assertSessions(deviceJids, false);
            }
          }
        } catch {
          // silencioso: es solo precalentamiento
        }
      };

      // ⬇️⬇️ **INYECCIÓN WA PARA TODOS LOS PLUGINS** ⬇️⬇️
      global.wa = { downloadContentFromMessage };
      // por comodidad, también accesible como conn.wa
      sock.wa = global.wa;
      // ⬆️⬆️------------------------------------------------ ⬆️⬆️

      setupConnection(sock);

      // 🌐 INICIAR API WEB DE LA SUKI BOT
try {
  startWebServer(sock);
} catch (e) {
  console.error("❌ Error iniciando API web:", e);
}

      
      // 🔧 Normaliza participants: si id es @lid y existe .jid (real), reemplaza por el real
      sock.lidParser = function (participants = []) {
        try {
          return participants.map(v => ({
            ...v,
            id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid)
              ? v.jid
              : v.id
          }));
        } catch (e) {
          console.error("[lidParser] error:", e);
          return participants || [];
        }
      };

      // 🧠 Ejecutar plugins con eventos especiales como bienvenida
      for (const plugin of global.plugins) {
        if (typeof plugin.run === "function") {
          try {
            // Pasamos wa como segundo argumento opcional (no rompe nada si el plugin no lo usa)
            plugin.run(sock, { wa: global.wa });
            console.log(chalk.magenta("🧠 Plugin con eventos conectado"));
          } catch (e) {
            console.error(chalk.red("❌ Error al ejecutar evento del plugin:"), e);
          }
        }
      }
      
      if (!fs.existsSync("./sessions/creds.json") && method === "2") {
        setTimeout(async () => {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(chalk.magenta("🔑 Código de vinculación: ") + chalk.yellow(code.match(/.{1,4}/g).join("-")));
        }, 2000);
      }


      
      // 💬 Manejo de mensajes

sock.ev.on("messages.upsert", async ({ messages }) => {
  const m = messages[0];
  if (!m || !m.message) return;

  // ⚡ Marca de entrada: los comandos (ej. ping) miden con esto la velocidad
  // REAL de procesamiento interno del bot.
  m.__recvAt = Date.now();

  // 🔥 Precalentar el caché de metadata del grupo SIN bloquear este mensaje,
  // para que los envíos al grupo no tengan que consultar la metadata.
  try {
    const __cid = m.key?.remoteJid;
    if (__cid && __cid.endsWith("@g.us") && global.groupMetaCache) {
      const __hit = global.groupMetaCache.get(__cid);
      if (!__hit || Date.now() - __hit.ts > 45000) {
        sock.groupMetadata(__cid).catch(() => {});
      }
      // Y precalentar dispositivos + sesiones de cifrado de los miembros
      // (en grupos grandes esto era lo que hacía lentos los envíos)
      sock.__prewarmGroup?.(__cid)?.catch?.(() => {});
    }
  } catch {}

  // 🔎 Normalización PROFUNDA: convierte LIDs a números reales en TODO el mensaje,
  // incluyendo chats PRIVADOS (consulta al signalRepository cuando hace falta).
  await (async () => {
    const DIGITS = (s = "") => (s || "").replace(/\D/g, "");
    const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
    const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

    // 🧠 Mapa global LID ↔ PN (se va llenando con cada mensaje)
    global.lidMap = global.lidMap || new Map();

    // 🔄 Resolver LID → PN (usa mapa local primero, luego consulta a Baileys)
    const toRealJid = async (jid) => {
      if (!jid || typeof jid !== "string") return jid;
      if (isUser(jid)) return jid;                         // ya es PN real
      if (!isLid(jid)) return jid;                         // no es LID, devolver tal cual

      // 1) Buscar en mapa local
      if (global.lidMap.has(jid)) return global.lidMap.get(jid);

      // 2) Intentar resolver con signalRepository (Baileys v7+)
      try {
        if (sock.signalRepository?.lidMapping?.getPNForLID) {
          const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
          if (pn && isUser(pn)) {
            global.lidMap.set(jid, pn);   // cachear para futuras llamadas
            global.lidMap.set(pn, jid);
            return pn;
          }
        }
      } catch {}

      // 3) No se pudo resolver, dejar el LID tal cual
      return jid;
    };

    // Versión sincrónica para campos donde no podemos usar await
    // (usa solo el mapa local, sin consultar a WhatsApp)
    const toRealJidSync = (jid) => {
      if (!jid || typeof jid !== "string") return jid;
      if (isUser(jid)) return jid;
      if (isLid(jid) && global.lidMap.has(jid)) return global.lidMap.get(jid);
      return jid;
    };

    // ========= PASO 1: Identificar el PN real del autor del mensaje =========
    // Prioridad 1: Campos PN explícitos (Baileys v6.8+/v7+ los trae en grupos)
    const altPn =
      (isUser(m.key?.senderPn)        && m.key.senderPn) ||
      (isUser(m.key?.participantPn)   && m.key.participantPn) ||
      (isUser(m.key?.senderAlt)       && m.key.senderAlt) ||
      (isUser(m.key?.participantAlt)  && m.key.participantAlt) ||
      null;

    // Prioridad 2: Campos legacy (forks custom)
    const legacy =
      (isUser(m.key?.jid)         && m.key.jid) ||
      (isUser(m.key?.participant) && m.key.participant) ||
      (m.key?.remoteJid && !m.key.remoteJid.endsWith("@g.us") && isUser(m.key.remoteJid) && m.key.remoteJid) ||
      null;

    let realJidOfSender = altPn || legacy;

    // Capturar el LID del autor
    const lidOfSender =
      (isLid(m.key?.senderLid)       && m.key.senderLid) ||
      (isLid(m.key?.participantLid)  && m.key.participantLid) ||
      (isLid(m.key?.participant)     && m.key.participant) ||
      (isLid(m.key?.remoteJid)       && m.key.remoteJid) ||
      null;

    // 🆕 PRIVADOS: si no tenemos PN pero SÍ tenemos un LID, consultar a Baileys
    if (!realJidOfSender && lidOfSender) {
      const resolved = await toRealJid(lidOfSender);
      if (resolved && isUser(resolved)) {
        realJidOfSender = resolved;
      }
    }

    // ========= PASO 2: Guardar el mapeo LID ↔ PN =========
    if (realJidOfSender && lidOfSender) {
      global.lidMap.set(lidOfSender, realJidOfSender);
      global.lidMap.set(realJidOfSender, lidOfSender);
    }

    // ========= PASO 3: Sobrescribir los campos del mensaje =========
    if (realJidOfSender) {
      m.key.jid = realJidOfSender;
      m.key.participant = realJidOfSender;
      m.realJid = realJidOfSender;
      m.realNumber = DIGITS(realJidOfSender);
      m.realLid = lidOfSender;
    } else if (lidOfSender) {
      m.realJid = lidOfSender;
      m.realNumber = DIGITS(lidOfSender);
      m.realLid = lidOfSender;
    } else {
      m.realJid = null;
      m.realNumber = null;
      m.realLid = null;
    }

    // ========= PASO 4: Normalizar el remoteJid si es LID en chat privado =========
    if (m.key?.remoteJid && isLid(m.key.remoteJid) && realJidOfSender) {
      m.key.remoteJid = realJidOfSender;
    }

    // ========= PASO 5: Normalizar el contextInfo =========
    const ctx =
      m.message?.extendedTextMessage?.contextInfo ||
      m.message?.imageMessage?.contextInfo ||
      m.message?.videoMessage?.contextInfo ||
      m.message?.documentMessage?.contextInfo ||
      m.message?.audioMessage?.contextInfo ||
      m.message?.stickerMessage?.contextInfo ||
      null;

    if (ctx) {
      // Participant del mensaje citado (cuando responden a alguien)
      if (ctx.participant) {
        ctx.participant = await toRealJid(ctx.participant);
      }
      if (ctx.participantPn && isUser(ctx.participantPn)) {
        ctx.participant = ctx.participantPn;
      }

      // remoteJid del contexto
      if (ctx.remoteJid && isLid(ctx.remoteJid)) {
        ctx.remoteJid = await toRealJid(ctx.remoteJid);
      }

      // Menciones con @ (usa versión sincrónica porque es array)
      if (Array.isArray(ctx.mentionedJid)) {
        ctx.mentionedJid = ctx.mentionedJid.map(toRealJidSync);
      }

      // Grupos mencionados
      if (Array.isArray(ctx.groupMentions)) {
        ctx.groupMentions = ctx.groupMentions.map((g) => {
          if (g && g.groupJid) g.groupJid = toRealJidSync(g.groupJid);
          return g;
        });
      }
    }

    // ========= PASO 6: Exponer helpers globales =========
    global.resolveRealJid = toRealJidSync;
    global.resolveRealJidAsync = toRealJid;
    global.resolveRealNumber = (jid) => DIGITS(toRealJidSync(jid) || "");
  })();

  global.mActual = m; // debug opcional

  const chatId = m.key.remoteJid;
  const sender = m.key.participant || m.key.remoteJid; // participant ya viene normalizado al real
  const fromMe = m.key.fromMe || sender === sock.user.id;
  const isGroup = chatId.endsWith("@g.us");

  let messageContent =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";


  console.log(chalk.yellow(`\n📩 Nuevo mensaje recibido`));
  console.log(chalk.green(`📨 De: ${fromMe ? "[Tú]" : "[Usuario]"} ${chalk.bold(sender)}`));
  console.log(chalk.cyan(`💬 Tipo: ${Object.keys(m.message)[0]}`));
  console.log(chalk.cyan(`💬 Texto: ${chalk.bold(messageContent || "📂 (Multimedia)")}`));



/* === STICKER → COMANDO (GLOBAL) usando ./comandos.json — para Suki === */
try {
  const st =
    m.message?.stickerMessage ||
    m.message?.ephemeralMessage?.message?.stickerMessage ||
    null;

  if (st && fs.existsSync("./comandos.json")) {
    // 1) Generar CLAVES posibles para el sticker (base64 y "126,67,...")
    const rawSha = st.fileSha256 || st.fileSha256Hash || st.filehash;
    const candidates = [];

    if (rawSha) {
      if (Buffer.isBuffer(rawSha)) {
        candidates.push(rawSha.toString("base64"));              // base64 (Buffer)
        candidates.push(Array.from(rawSha).toString());          // "126,67,..."
      } else if (ArrayBuffer.isView(rawSha)) { // Uint8Array, etc.
        const buf = Buffer.from(rawSha);
        candidates.push(buf.toString("base64"));
        candidates.push(Array.from(rawSha).toString());
      } else if (typeof rawSha === "string") {
        candidates.push(rawSha); // ya viene como string
      }
    }

    // 2) Buscar comando en ./comandos.json probando todas las claves
    let mapped = null;
    const map = JSON.parse(fs.readFileSync("./comandos.json", "utf-8") || "{}") || {};
    for (const k of candidates) {
      if (k && typeof map[k] === "string" && map[k].trim()) {
        mapped = map[k].trim();
        break;
      }
    }

    if (mapped) {
      // 3) Asegurar prefijo si el comando se guardó sin prefijo
      const ensurePrefixed = (t) => {
        const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
        return (Array.isArray(global.prefixes) && global.prefixes.some(p => t.startsWith(p)))
          ? t
          : (pref + t);
      };
      const injectedText = ensurePrefixed(mapped);

      // 4) Inyectar el "texto" del comando en el mensaje
      //    (agregamos extendedTextMessage PERO conservamos stickerMessage para que otras lógicas sigan viéndolo como sticker)
      const ctx = st.contextInfo || {};
      m.message.extendedTextMessage = {
        text: injectedText,
        contextInfo: {
          quotedMessage: ctx.quotedMessage || null,
          participant: ctx.participant || null,
          stanzaId: ctx.stanzaId || "",
          remoteJid: ctx.remoteJid || m.key.remoteJid,
          mentionedJid: Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []
        }
      };

      // 5) Actualizar el buffer de texto que usa el parser de comandos
      messageContent = injectedText;

      // (Opcional) marcas de depuración
      m._stickerCmdInjected = true;
      m._stickerCmdText = injectedText;
    }
  }
} catch (e) {
  console.error("❌ Sticker→cmd error:", e);
}
/* === FIN STICKER → COMANDO === */




  
// ——— Presentación automática (solo una vez por grupo) ———
  if (isGroup) {
    const welcomePath = path.resolve("setwelcome.json");
    // Asegurarnos de que existe y cargar
    if (!fs.existsSync(welcomePath)) fs.writeFileSync(welcomePath, "{}");
    const welcomeData = JSON.parse(fs.readFileSync(welcomePath, "utf-8"));

    welcomeData[chatId] = welcomeData[chatId] || {};
    if (!welcomeData[chatId].presentationSent) {
      // Enviar vídeo de presentación
      await sock.sendMessage(chatId, {
        video: { url: "https://cdn.russellxz.click/bc06f25b.mp4" },
        caption: `
🎉 ¡Hola a todos! 🎉

👋 Soy *La Suki Bot*, un bot programado 🤖.  
📸 A veces reacciono o envío multimedia porque así me diseñaron.  

⚠️ *Lo que diga no debe ser tomado en serio.* 😉

📌 Usa el comando *.menu* o *.menugrupo* para ver cómo usarme y programar cosas.  
Soy un bot *sencillo y fácil de usar*, ¡gracias por tenerme en el grupo! 💖  
        `.trim()
      });
      // Marcar como enviado y guardar
      welcomeData[chatId].presentationSent = true;
      fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));
    }
  }
  //fin de la logica
  
// === INICIO LÓGICA CHATGPT POR GRUPO CON activos.db ===
try {
  const isGroup = m.key.remoteJid.endsWith("@g.us");
  const chatId = m.key.remoteJid;
  const fromMe = m.key.fromMe;

  const chatgptActivo = await getConfig(chatId, "chatgpt");

  const messageText = m.message?.conversation ||
                      m.message?.extendedTextMessage?.text ||
                      m.message?.imageMessage?.caption ||
                      m.message?.videoMessage?.caption || "";

  if (isGroup && chatgptActivo == 1 && !fromMe && messageText.length > 0) {
    const encodedText = encodeURIComponent(messageText);
    const sessionID = "1727468410446638";
    const apiUrl = `https://api.neoxr.eu/api/gpt4-session?q=${encodedText}&session=${sessionID}&apikey=russellxz`;

    const res = await axios.get(apiUrl);
    const respuesta = res.data?.data?.message;

    if (respuesta) {
      await sock.sendMessage(chatId, {
        text: respuesta
      }, { quoted: m });
    }
  }
} catch (e) {
  console.error("❌ Error en lógica ChatGPT por grupo:", e);
}
// === FIN LÓGICA CHATGPT POR GRUPO CON activos.db ===

// === LÓGICA DE RESPUESTA AUTOMÁTICA CON PALABRA CLAVE (híbrida: carpeta + base64) ===
try {

  const activossPath = path.resolve("./activoss.json");

  let activossData = {};
  try {
    if (fs.existsSync(activossPath)) {
      activossData = JSON.parse(fs.readFileSync(activossPath, "utf-8"));
    }
  } catch {
    activossData = {};
  }

  const estadoReacion = String(activossData?.[chatId]?.reacion || "on").toLowerCase();

  // Si el grupo NO existe en activoss.json => activa por defecto.
  // Si existe y está off => no responde nada.
  // Si existe y está on => responde normal.
  if (estadoReacion !== "off") {
    const guarPath = path.resolve("./guar.json");
    const guarFilesPath = path.resolve("./guar_files.json");

    let guarData = {};

    // 1) Cargar viejo base64
    if (fs.existsSync(guarPath)) {
      try {
        guarData = JSON.parse(fs.readFileSync(guarPath, "utf-8"));
      } catch {
        guarData = {};
      }
    }

    // 2) Cargar nuevo por rutas y combinar
    if (fs.existsSync(guarFilesPath)) {
      try {
        const filesDb = JSON.parse(fs.readFileSync(guarFilesPath, "utf-8"));

        for (const k of Object.keys(filesDb)) {
          if (!Array.isArray(guarData[k])) guarData[k] = [];
          guarData[k] = guarData[k].concat(filesDb[k]);
        }
      } catch {}
    }

    if (Object.keys(guarData).length > 0) {
      const cleanText = String(messageContent || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w]/g, "");

      for (const key of Object.keys(guarData)) {
        const cleanKey = String(key || "")
          .toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^\w]/g, "");

        if (cleanText === cleanKey && guarData[key]?.length) {
          const item = guarData[key][Math.floor(Math.random() * guarData[key].length)];

          let buffer = null;

          // Primero archivo físico
          if (item.path) {
            try {
              const filePath = path.resolve(item.path);
              if (fs.existsSync(filePath)) {
                buffer = fs.readFileSync(filePath);
              }
            } catch {}
          }

          // Fallback base64 viejo
          if (!buffer && item.media) {
            try {
              buffer = Buffer.from(item.media, "base64");
            } catch {}
          }

          if (!buffer || !buffer.length) return;

          const extension = String(item.ext || item.mime?.split("/")?.[1] || "bin").toLowerCase();
          const mime = item.mime || "";

          const options = { quoted: m };
          const payload = {};

          if (["jpg", "jpeg", "png"].includes(extension)) {
            payload.image = buffer;
          } else if (["mp4", "mkv", "webm"].includes(extension)) {
            payload.video = buffer;
          } else if (["mp3", "ogg", "opus"].includes(extension)) {
            payload.audio = buffer;
            payload.mimetype = mime || "audio/mpeg";
            payload.ptt = false;
          } else if (["webp"].includes(extension)) {
            payload.sticker = buffer;
          } else {
            payload.document = buffer;
            payload.mimetype = mime || "application/octet-stream";
            payload.fileName = item.fileName || `archivo.${extension}`;
          }

          await sock.sendMessage(chatId, payload, options);
          return;
        }
      }
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de palabra clave:", e);
}
// === FIN DE LÓGICA ===
  
// === ⛔ INICIO LÓGICA ANTIS STICKERS (bloqueo tras 3 strikes en 15s) ===
try {
  const chatId = m.key.remoteJid;
  const fromMe = m.key.fromMe;
  const isGroup = chatId.endsWith("@g.us");
  const stickerMsg = m.message?.stickerMessage || m.message?.ephemeralMessage?.message?.stickerMessage;

  if (isGroup && !fromMe && stickerMsg) {
    const antisActivo = await getConfig(chatId, "antis");

    if (antisActivo == 1) {
      const user = m.key.participant || m.key.remoteJid;
      const now = Date.now();

      if (!global.antisSpam) global.antisSpam = {};
      if (!global.antisSpam[chatId]) global.antisSpam[chatId] = {};
      if (!global.antisBlackList) global.antisBlackList = {};

      const userData = global.antisSpam[chatId][user] || {
        count: 0,
        last: now,
        warned: false,
        strikes: 0
      };

      const timePassed = now - userData.last;

      if (timePassed > 15000) {
        userData.count = 1;
        userData.last = now;
        userData.warned = false;
        userData.strikes = 0;

        if (global.antisBlackList[chatId]?.includes(user)) {
          global.antisBlackList[chatId] = global.antisBlackList[chatId].filter(u => u !== user);
        }
      } else {
        userData.count++;
        userData.last = now;
      }

      global.antisSpam[chatId][user] = userData;

      if (userData.count === 5) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${user.split("@")[0]} has enviado *5 stickers*. Espera *15 segundos* o si envías *3 más*, serás eliminado.`,
          mentions: [user]
        });
        userData.warned = true;
        userData.strikes = 0;
      }

      if (userData.count > 5 && timePassed < 15000) {
        if (!global.antisBlackList[chatId]) global.antisBlackList[chatId] = [];
        if (!global.antisBlackList[chatId].includes(user)) {
          global.antisBlackList[chatId].push(user);
        }

        await sock.sendMessage(chatId, {
          delete: {
            remoteJid: chatId,
            fromMe: false,
            id: m.key.id,
            participant: user
          }
        });

        userData.strikes++;

        if (userData.strikes >= 3) {
          await sock.sendMessage(chatId, {
            text: `❌ @${user.split("@")[0]} fue eliminado por ignorar advertencias y abusar de stickers.`,
            mentions: [user]
          });
          await sock.groupParticipantsUpdate(chatId, [user], "remove");
          delete global.antisSpam[chatId][user];
        }
      }

      global.antisSpam[chatId][user] = userData;
    }
  }
} catch (e) {
  console.error("❌ Error en lógica antis stickers:", e);
}
// === ✅ FIN LÓGICA ANTIS STICKERS ===

// === ✅ INICIO CONTEO DE MENSAJES EN setwelcome.json PN / LID ===
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
  const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid = (j) => typeof j === "string" && j.endsWith("@lid");

  const addZero = (n) => {
    const clean = DIGITS(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const cleanUserJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@s.whatsapp.net` : null;
  };

  const cleanLidJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@lid` : null;
  };

  async function getSenderChatKeys() {
    const botNumber = JID_NUM(sock.user?.id || sock.user?.jid || "");
    const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : "";

    const raw = m.key.fromMe
      ? botJid
      : String(m.key.participant || m.key.remoteJid || "");

    let realJid = null;
    let lidJid = null;

    const pnFields = [
      m.realJid,
      m.key?.senderPn,
      m.key?.participantPn,
      m.key?.senderAlt,
      m.key?.participantAlt,
      raw
    ].filter(Boolean);

    for (const jid of pnFields) {
      if (isUser(jid)) {
        realJid = cleanUserJid(jid);
        break;
      }
    }

    const lidFields = [
      m.realLid,
      m.realJid,
      m.key?.senderLid,
      m.key?.participantLid,
      raw
    ].filter(Boolean);

    for (const jid of lidFields) {
      if (isLid(jid)) {
        lidJid = cleanLidJid(jid);
        break;
      }
    }

    try {
      if (global.lidMap instanceof Map) {
        if (lidJid && !realJid) {
          const pn = global.lidMap.get(lidJid);
          if (isUser(pn)) realJid = cleanUserJid(pn);
        }

        if (realJid && !lidJid) {
          const lid = global.lidMap.get(realJid);
          if (isLid(lid)) lidJid = cleanLidJid(lid);
        }
      }
    } catch {}

    try {
      if (lidJid && !realJid) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
        if (isUser(pn)) {
          realJid = cleanUserJid(pn);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(lidJid, realJid);
            global.lidMap.set(realJid, lidJid);
          }
        }
      }
    } catch {}

    try {
      if (realJid && !lidJid) {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
        if (isLid(lid)) {
          lidJid = cleanLidJid(lid);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(realJid, lidJid);
            global.lidMap.set(lidJid, realJid);
          }
        }
      }
    } catch {}

    let baseNumber = realJid ? JID_NUM(realJid) : "";
    let lidNumber = lidJid ? JID_NUM(lidJid) : "";

    if (!baseNumber && isUser(raw)) baseNumber = JID_NUM(raw);
    if (!lidNumber && isLid(raw)) lidNumber = JID_NUM(raw);

    if (!baseNumber && m.realNumber && isUser(m.realJid)) {
      baseNumber = DIGITS(m.realNumber);
    }

    if (!lidNumber && m.realNumber && (isLid(m.realJid) || isLid(m.realLid) || isLid(raw))) {
      lidNumber = DIGITS(m.realNumber);
    }

    const zeroNumber = baseNumber ? addZero(baseNumber) : "";

    const keys = [];

    if (baseNumber) keys.push(baseNumber);
    if (zeroNumber && zeroNumber !== baseNumber) keys.push(zeroNumber);
    if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) keys.push(lidNumber);

    const rawNumber = JID_NUM(raw);
    if (!keys.length && rawNumber) keys.push(rawNumber);

    return [...new Set(keys)];
  }

  const welcomePath = path.resolve("setwelcome.json");

  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(welcomePath, JSON.stringify({}, null, 2));
  }

  let welcomeData = {};
  try {
    welcomeData = JSON.parse(fs.readFileSync(welcomePath, "utf-8"));
  } catch {
    welcomeData = {};
  }

  const chatId = m.key.remoteJid;
  const isGroup = typeof chatId === "string" && chatId.endsWith("@g.us");

  if (isGroup) {
    welcomeData[chatId] = welcomeData[chatId] || {};
    welcomeData[chatId].chatCount = welcomeData[chatId].chatCount || {};

    const keys = await getSenderChatKeys();

    if (keys.length) {
      let current = 0;

      for (const key of keys) {
        const val = Number(welcomeData[chatId].chatCount[key] || 0);
        if (val > current) current = val;
      }

      const next = current + 1;

      for (const key of keys) {
        welcomeData[chatId].chatCount[key] = next;
      }

      fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));
    }
  }
} catch (e) {
  console.error("❌ Error en conteo de mensajes en setwelcome.json:", e);
}
// === ✅ FIN CONTEO DE MENSAJES EN setwelcome.json PN / LID ===
  
// === ⛔ INICIO GUARDADO ANTIDELETE (con activos.db y antidelete.db) ===
try {
  const isGroup = chatId.endsWith("@g.us");

  const antideleteGroupActive = isGroup ? await getConfig(chatId, "antidelete") == 1 : false;
  const antideletePrivActive = !isGroup ? await getConfig("global", "antideletepri") == 1 : false;

  if (antideleteGroupActive || antideletePrivActive) {
    const idMsg = m.key.id;
    const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net";
    const senderId = m.key.participant || (m.key.fromMe ? botNumber : m.key.remoteJid);
    const type = Object.keys(m.message || {})[0];
    const content = m.message[type];

    // ❌ No guardar si es view once
    if (type === "viewOnceMessageV2") return;

    // ❌ No guardar si supera 10MB
    if (
      ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type) &&
      content.fileLength > 10 * 1024 * 1024
    ) return;

    // Objeto base
    const guardado = {
      chatId,
      sender: senderId,
      type,
      timestamp: Date.now()
    };

    // Función para guardar multimedia en base64
    const saveBase64 = async (mediaType, data) => {
      const stream = await downloadContentFromMessage(data, mediaType);
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      guardado.media = buffer.toString("base64");
      guardado.mimetype = data.mimetype;
    };

    // ✅ CORREGIDO: Usamos await para asegurarnos que se termine de guardar
    if (["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type)) {
      const mediaType = type.replace("Message", "");
      await saveBase64(mediaType, content); // 👈 ESTE await es clave
    }

    // Texto
    if (type === "conversation" || type === "extendedTextMessage") {
      guardado.text = m.message.conversation || m.message.extendedTextMessage?.text || "";
    }

    // Guardar en antidelete.db
    const db = getAntideleteDB();
    const scope = isGroup ? "g" : "p";
    db[scope][idMsg] = guardado;
    saveAntideleteDB(db);
  }
} catch (e) {
  console.error("❌ Error en lógica ANTIDELETE:", e);
}
// === ✅ FIN GUARDADO ANTIDELETE ===
// === INICIO DETECCIÓN DE MENSAJE ELIMINADO ===
if (m.message?.protocolMessage?.type === 0) {
  try {
    const deletedId = m.message.protocolMessage.key.id;
    const whoDeleted = m.message.protocolMessage.key.participant || m.key.participant || m.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const senderNumber = (whoDeleted || '').replace(/[^0-9]/g, '');
    const mentionTag = [`${senderNumber}@s.whatsapp.net`];

    const antideleteEnabled = isGroup
  ? (await getConfig(chatId, "antidelete")) === "1"
  : (await getConfig("global", "antideletepri")) === "1";

    if (!antideleteEnabled) return;

    const dbPath = "./antidelete.db";

    if (!fs.existsSync(dbPath)) return;

    const db = JSON.parse(fs.readFileSync(dbPath));
    const tipo = isGroup ? "g" : "p";
    const data = db[tipo] || {};
    const deletedData = data[deletedId];
    if (!deletedData) return;

    const senderClean = (deletedData.sender || '').replace(/[^0-9]/g, '');
    if (senderClean !== senderNumber) return;

    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(chatId);
        const isAdmin = meta.participants.find(p => p.id === `${senderNumber}@s.whatsapp.net`)?.admin;
        if (isAdmin) return;
      } catch (e) {
        console.error("❌ Error leyendo metadata:", e);
        return;
      }
    }

    const type = deletedData.type;
    const mimetype = deletedData.mimetype || 'application/octet-stream';
    const buffer = deletedData.media ? Buffer.from(deletedData.media, "base64") : null;

    if (buffer) {
      const sendOpts = {
        [type.replace("Message", "")]: buffer,
        mimetype,
        quoted: m
      };

      if (type === "stickerMessage") {
        const sent = await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `📌 El sticker fue eliminado por @${senderNumber}`,
          mentions: mentionTag,
          quoted: sent
        });
      } else if (type === "audioMessage") {
        const sent = await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `🎧 El audio fue eliminado por @${senderNumber}`,
          mentions: mentionTag,
          quoted: sent
        });
      } else {
        sendOpts.caption = `📦 Mensaje eliminado por @${senderNumber}`;
        sendOpts.mentions = mentionTag;
        await sock.sendMessage(chatId, sendOpts, { quoted: m });
      }

    } else if (deletedData.text) {
      await sock.sendMessage(chatId, {
        text: `📝 *Mensaje eliminado:* ${deletedData.text}\n👤 *Usuario:* @${senderNumber}`,
        mentions: mentionTag
      }, { quoted: m });
    }

  } catch (err) {
    console.error("❌ Error en lógica antidelete:", err);
  }
}
// === FIN DETECCIÓN DE MENSAJE ELIMINADO ===

// 🔗 LÓGICA ANTILINK desde activos.db compatible PN / LID
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
  const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

  const addZero = (n) => {
    const clean = DIGITS(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const cleanUserJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@s.whatsapp.net` : null;
  };

  const cleanLidJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@lid` : null;
  };

  const safeIsOwner = (value) => {
    try {
      const raw = String(value || "");
      const num = JID_NUM(raw) || DIGITS(raw);

      if (typeof global.isOwner === "function") {
        if (raw && global.isOwner(raw)) return true;
        if (num && global.isOwner(num)) return true;
      }

      if (Array.isArray(global.owner)) {
        return global.owner.some((entry) => {
          if (Array.isArray(entry)) {
            return entry.some((x) => {
              const d = JID_NUM(x) || DIGITS(x);
              return d && d === num;
            });
          }

          const d = JID_NUM(entry) || DIGITS(entry);
          return d && d === num;
        });
      }

      return false;
    } catch {
      return false;
    }
  };

  async function getSenderIdentity() {
    const raw = String(m.key.participant || m.key.remoteJid || "");

    let realJid = null;
    let lidJid = null;

    const pnFields = [
      m.realJid,
      m.key?.senderPn,
      m.key?.participantPn,
      m.key?.senderAlt,
      m.key?.participantAlt,
      m.key?.participant,
      raw
    ].filter(Boolean);

    for (const jid of pnFields) {
      if (isUser(jid)) {
        realJid = cleanUserJid(jid);
        break;
      }
    }

    const lidFields = [
      m.realLid,
      m.realJid,
      m.key?.senderLid,
      m.key?.participantLid,
      m.key?.participant,
      raw
    ].filter(Boolean);

    for (const jid of lidFields) {
      if (isLid(jid)) {
        lidJid = cleanLidJid(jid);
        break;
      }
    }

    try {
      if (global.lidMap instanceof Map) {
        if (lidJid && !realJid) {
          const pn = global.lidMap.get(lidJid);
          if (isUser(pn)) realJid = cleanUserJid(pn);
        }

        if (realJid && !lidJid) {
          const lid = global.lidMap.get(realJid);
          if (isLid(lid)) lidJid = cleanLidJid(lid);
        }
      }
    } catch {}

    try {
      if (lidJid && !realJid) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
        if (isUser(pn)) {
          realJid = cleanUserJid(pn);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(lidJid, realJid);
            global.lidMap.set(realJid, lidJid);
          }
        }
      }
    } catch {}

    try {
      if (realJid && !lidJid) {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
        if (isLid(lid)) {
          lidJid = cleanLidJid(lid);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(realJid, lidJid);
            global.lidMap.set(lidJid, realJid);
          }
        }
      }
    } catch {}

    const pnNumber = realJid ? JID_NUM(realJid) : "";
    const zeroNumber = pnNumber ? addZero(pnNumber) : "";
    const lidNumber = lidJid ? JID_NUM(lidJid) : "";
    const realNumber = m.realNumber ? DIGITS(m.realNumber) : "";
    const rawNumber = JID_NUM(raw);

    const numbers = new Set();

    if (pnNumber) numbers.add(pnNumber);
    if (zeroNumber && zeroNumber !== pnNumber) numbers.add(zeroNumber);
    if (lidNumber && lidNumber !== pnNumber && lidNumber !== zeroNumber) numbers.add(lidNumber);
    if (realNumber) numbers.add(realNumber);
    if (rawNumber) numbers.add(rawNumber);

    if (realNumber && (isUser(m.realJid) || isUser(raw))) {
      const rz = addZero(realNumber);
      if (rz && rz !== realNumber) numbers.add(rz);
    }

    return {
      raw,
      realJid,
      lidJid,
      pnNumber,
      lidNumber,
      realNumber,
      rawNumber,
      numbers,
      mentionJid: realJid || lidJid || raw,
      mentionNum: pnNumber || realNumber || lidNumber || rawNumber || "usuario"
    };
  }

  async function isAdminByIdentity(chatId, identity) {
    try {
      const meta = await sock.groupMetadata(chatId);
      const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

      const adminNums = new Set();

      for (const p of rawParts) {
        const flagAdmin = p?.admin === "admin" || p?.admin === "superadmin";
        if (!flagAdmin) continue;

        const ids = [
          p?.id,
          p?.jid,
          p?.lid,
          p?.pn,
          p?.phoneNumber,
          p?.jidAlt
        ].filter(x => typeof x === "string");

        try {
          if (typeof sock.lidParser === "function") {
            const parsed = sock.lidParser([p]);
            if (parsed?.[0]?.id) ids.push(parsed[0].id);
            if (parsed?.[0]?.jid) ids.push(parsed[0].jid);
          }
        } catch {}

        for (const id of ids) {
          const d = JID_NUM(id);
          if (d) {
            adminNums.add(d);

            const dz = addZero(d);
            if (dz && dz !== d) adminNums.add(dz);
          }

          if (isLid(id)) {
            try {
              if (global.lidMap instanceof Map) {
                const mapped = global.lidMap.get(cleanLidJid(id));
                const md = JID_NUM(mapped);
                if (md) {
                  adminNums.add(md);

                  const md0 = addZero(md);
                  if (md0 && md0 !== md) adminNums.add(md0);
                }
              }
            } catch {}

            try {
              const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(cleanLidJid(id));
              if (isUser(pn)) {
                const pd = JID_NUM(pn);
                if (pd) {
                  adminNums.add(pd);

                  const pd0 = addZero(pd);
                  if (pd0 && pd0 !== pd) adminNums.add(pd0);
                }

                if (global.lidMap instanceof Map) {
                  const lidClean = cleanLidJid(id);
                  const pnClean = cleanUserJid(pn);
                  global.lidMap.set(lidClean, pnClean);
                  global.lidMap.set(pnClean, lidClean);
                }
              }
            } catch {}
          }
        }
      }

      return [...identity.numbers].some(n => adminNums.has(n));
    } catch {
      return false;
    }
  }

  async function deleteMessage(chatId, identity) {
    const deleteKeys = [];

    deleteKeys.push(m.key);

    const possibleParticipants = [
      m.key?.participant,
      identity.raw,
      identity.lidJid,
      identity.realJid
    ].filter(Boolean);

    for (const participant of [...new Set(possibleParticipants)]) {
      deleteKeys.push({
        remoteJid: chatId,
        fromMe: false,
        id: m.key.id,
        participant
      });
    }

    for (const key of deleteKeys) {
      try {
        await sock.sendMessage(chatId, { delete: key });
        return true;
      } catch {}
    }

    return false;
  }

  async function removeUser(chatId, identity) {
    const ids = [
      identity.raw,
      identity.realJid,
      identity.lidJid
    ].filter(Boolean);

    for (const jid of [...new Set(ids)]) {
      try {
        await sock.groupParticipantsUpdate(chatId, [jid], "remove");
        return true;
      } catch {}
    }

    return false;
  }

  const chatId = m.key.remoteJid;
  const isGroupHere = typeof chatId === "string" && chatId.endsWith("@g.us");

  const antilinkState = await getConfig(chatId, "antilink");

  if (isGroupHere && parseInt(antilinkState) === 1) {
    const texto =
      String(
        (typeof messageContent !== "undefined" && messageContent) ||
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        ""
      );

    const invitaWA = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(texto);

    if (invitaWA) {
      const identity = await getSenderIdentity();

      const isOwnerHere =
        safeIsOwner(identity.raw) ||
        safeIsOwner(identity.realJid) ||
        safeIsOwner(identity.lidJid) ||
        [...identity.numbers].some(n => safeIsOwner(n));

      const isAdminHere = await isAdminByIdentity(chatId, identity);
      const fromMeHere = !!m.key.fromMe;

      if (!fromMeHere && !isOwnerHere && !isAdminHere) {
        await deleteMessage(chatId, identity);

        const advPath = path.resolve("./advertencias.json");

        if (!fs.existsSync(advPath)) {
          fs.writeFileSync(advPath, JSON.stringify({}, null, 2));
        }

        let advertencias = {};
        try {
          advertencias = JSON.parse(fs.readFileSync(advPath, "utf-8"));
        } catch {
          advertencias = {};
        }

        advertencias[chatId] = advertencias[chatId] || {};

        const keys = [...identity.numbers].filter(Boolean);
        let current = 0;

        for (const k of keys) {
          const n = Number(advertencias[chatId][k] || 0);
          if (n > current) current = n;
        }

        const total = current + 1;

        for (const k of keys) {
          advertencias[chatId][k] = total;
        }

        fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));

        if (total >= 3) {
          await sock.sendMessage(chatId, {
            text: `❌ @${identity.mentionNum} fue eliminado por enviar invitaciones prohibidas (3/3).`,
            mentions: [identity.mentionJid]
          }).catch(() => {});

          const removed = await removeUser(chatId, identity);

          if (removed) {
            for (const k of keys) {
              advertencias[chatId][k] = 0;
            }

            fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));
          }
        } else {
          await sock.sendMessage(chatId, {
            text: `⚠️ @${identity.mentionNum}, enviar invitaciones de WhatsApp no está permitido aquí.\nAdvertencia: ${total}/3.`,
            mentions: [identity.mentionJid]
          }).catch(() => {});
        }

        return;
      }
    }
  }
} catch (e) {
  console.error("❌ Error final en lógica ANTILINK:", e);
}
// === FIN LÓGICA ANTILINK ===

  // === LÓGICA LINKALL DESDE activos.db compatible PN / LID ===
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
  const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);

  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

  const addZero = (n) => {
    const clean = DIGITS(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const cleanUserJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@s.whatsapp.net` : null;
  };

  const cleanLidJid = (jid) => {
    const n = JID_NUM(jid);
    return n ? `${n}@lid` : null;
  };

  const safeIsOwner = (value) => {
    try {
      const raw = String(value || "");
      const num = JID_NUM(raw) || DIGITS(raw);

      if (typeof global.isOwner === "function") {
        if (raw && global.isOwner(raw)) return true;
        if (num && global.isOwner(num)) return true;
      }

      if (Array.isArray(global.owner)) {
        return global.owner.some((entry) => {
          if (Array.isArray(entry)) {
            return entry.some((x) => {
              const d = JID_NUM(x) || DIGITS(x);
              return d && d === num;
            });
          }

          const d = JID_NUM(entry) || DIGITS(entry);
          return d && d === num;
        });
      }

      return false;
    } catch {
      return false;
    }
  };

  async function getSenderIdentity() {
    const raw = String(m.key.participant || m.key.remoteJid || "");

    let realJid = null;
    let lidJid = null;

    const pnFields = [
      m.realJid,
      m.key?.senderPn,
      m.key?.participantPn,
      m.key?.senderAlt,
      m.key?.participantAlt,
      m.key?.participant,
      raw
    ].filter(Boolean);

    for (const jid of pnFields) {
      if (isUser(jid)) {
        realJid = cleanUserJid(jid);
        break;
      }
    }

    const lidFields = [
      m.realLid,
      m.realJid,
      m.key?.senderLid,
      m.key?.participantLid,
      m.key?.participant,
      raw
    ].filter(Boolean);

    for (const jid of lidFields) {
      if (isLid(jid)) {
        lidJid = cleanLidJid(jid);
        break;
      }
    }

    try {
      if (global.lidMap instanceof Map) {
        if (lidJid && !realJid) {
          const pn = global.lidMap.get(lidJid);
          if (isUser(pn)) realJid = cleanUserJid(pn);
        }

        if (realJid && !lidJid) {
          const lid = global.lidMap.get(realJid);
          if (isLid(lid)) lidJid = cleanLidJid(lid);
        }
      }
    } catch {}

    try {
      if (lidJid && !realJid) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
        if (isUser(pn)) {
          realJid = cleanUserJid(pn);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(lidJid, realJid);
            global.lidMap.set(realJid, lidJid);
          }
        }
      }
    } catch {}

    try {
      if (realJid && !lidJid) {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
        if (isLid(lid)) {
          lidJid = cleanLidJid(lid);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(realJid, lidJid);
            global.lidMap.set(lidJid, realJid);
          }
        }
      }
    } catch {}

    const pnNumber = realJid ? JID_NUM(realJid) : "";
    const zeroNumber = pnNumber ? addZero(pnNumber) : "";
    const lidNumber = lidJid ? JID_NUM(lidJid) : "";
    const realNumber = m.realNumber ? DIGITS(m.realNumber) : "";
    const rawNumber = JID_NUM(raw);

    const numbers = new Set();

    if (pnNumber) numbers.add(pnNumber);
    if (zeroNumber && zeroNumber !== pnNumber) numbers.add(zeroNumber);
    if (lidNumber && lidNumber !== pnNumber && lidNumber !== zeroNumber) numbers.add(lidNumber);
    if (realNumber) numbers.add(realNumber);
    if (rawNumber) numbers.add(rawNumber);

    if (realNumber && (isUser(m.realJid) || isUser(raw))) {
      const rz = addZero(realNumber);
      if (rz && rz !== realNumber) numbers.add(rz);
    }

    return {
      raw,
      realJid,
      lidJid,
      pnNumber,
      lidNumber,
      realNumber,
      rawNumber,
      numbers,
      mentionJid: realJid || lidJid || raw,
      mentionNum: pnNumber || realNumber || lidNumber || rawNumber || "usuario"
    };
  }

  async function isAdminByIdentity(chatId, identity) {
    try {
      const meta = await sock.groupMetadata(chatId);
      const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

      const adminNums = new Set();

      for (const p of rawParts) {
        const flagAdmin = p?.admin === "admin" || p?.admin === "superadmin";
        if (!flagAdmin) continue;

        const ids = [
          p?.id,
          p?.jid,
          p?.lid,
          p?.pn,
          p?.phoneNumber,
          p?.jidAlt
        ].filter(x => typeof x === "string");

        try {
          if (typeof sock.lidParser === "function") {
            const parsed = sock.lidParser([p]);
            if (parsed?.[0]?.id) ids.push(parsed[0].id);
            if (parsed?.[0]?.jid) ids.push(parsed[0].jid);
          }
        } catch {}

        for (const id of ids) {
          const d = JID_NUM(id);
          if (d) {
            adminNums.add(d);

            const dz = addZero(d);
            if (dz && dz !== d) adminNums.add(dz);
          }

          if (isLid(id)) {
            try {
              if (global.lidMap instanceof Map) {
                const mapped = global.lidMap.get(cleanLidJid(id));
                const md = JID_NUM(mapped);
                if (md) {
                  adminNums.add(md);

                  const md0 = addZero(md);
                  if (md0 && md0 !== md) adminNums.add(md0);
                }
              }
            } catch {}

            try {
              const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(cleanLidJid(id));
              if (isUser(pn)) {
                const pd = JID_NUM(pn);
                if (pd) {
                  adminNums.add(pd);

                  const pd0 = addZero(pd);
                  if (pd0 && pd0 !== pd) adminNums.add(pd0);
                }

                if (global.lidMap instanceof Map) {
                  const lidClean = cleanLidJid(id);
                  const pnClean = cleanUserJid(pn);
                  global.lidMap.set(lidClean, pnClean);
                  global.lidMap.set(pnClean, lidClean);
                }
              }
            } catch {}
          }
        }
      }

      return [...identity.numbers].some(n => adminNums.has(n));
    } catch {
      return false;
    }
  }

  async function deleteMessage(chatId, identity) {
    const deleteKeys = [];

    deleteKeys.push(m.key);

    const possibleParticipants = [
      m.key?.participant,
      identity.raw,
      identity.lidJid,
      identity.realJid
    ].filter(Boolean);

    for (const participant of [...new Set(possibleParticipants)]) {
      deleteKeys.push({
        remoteJid: chatId,
        fromMe: false,
        id: m.key.id,
        participant
      });
    }

    for (const key of deleteKeys) {
      try {
        await sock.sendMessage(chatId, { delete: key });
        return true;
      } catch {}
    }

    return false;
  }

  async function removeUser(chatId, identity) {
    const ids = [
      identity.raw,
      identity.realJid,
      identity.lidJid
    ].filter(Boolean);

    for (const jid of [...new Set(ids)]) {
      try {
        await sock.groupParticipantsUpdate(chatId, [jid], "remove");
        return true;
      } catch {}
    }

    return false;
  }

  const chatId = m.key.remoteJid;
  const isGroupHere = typeof chatId === "string" && chatId.endsWith("@g.us");

  const estadoLinkAll = await getConfig(chatId, "linkall");

  if (isGroupHere && parseInt(estadoLinkAll) === 1) {
    const texto =
      String(
        (typeof messageContent !== "undefined" && messageContent) ||
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        ""
      );

    const contieneLink = /https?:\/\/[^\s]+/i.test(texto);
    const esWhatsAppGroup = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(texto);

    if (contieneLink && !esWhatsAppGroup) {
      const identity = await getSenderIdentity();

      const isOwnerHere =
        safeIsOwner(identity.raw) ||
        safeIsOwner(identity.realJid) ||
        safeIsOwner(identity.lidJid) ||
        [...identity.numbers].some(n => safeIsOwner(n));

      const isAdminHere = await isAdminByIdentity(chatId, identity);
      const fromMeHere = !!m.key.fromMe;

      if (!fromMeHere && !isOwnerHere && !isAdminHere) {
        await deleteMessage(chatId, identity);

        const advPath = path.resolve("./advertencias.json");

        if (!fs.existsSync(advPath)) {
          fs.writeFileSync(advPath, JSON.stringify({}, null, 2));
        }

        let advertencias = {};
        try {
          advertencias = JSON.parse(fs.readFileSync(advPath, "utf-8"));
        } catch {
          advertencias = {};
        }

        advertencias[chatId] = advertencias[chatId] || {};

        const keys = [...identity.numbers].filter(Boolean);
        let current = 0;

        for (const k of keys) {
          const n = Number(advertencias[chatId][k] || 0);
          if (n > current) current = n;
        }

        const total = current + 1;

        for (const k of keys) {
          advertencias[chatId][k] = total;
        }

        fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));

        if (total >= 10) {
          await sock.sendMessage(chatId, {
            text: `❌ @${identity.mentionNum} fue eliminado por enviar enlaces prohibidos (10/10).`,
            mentions: [identity.mentionJid]
          }).catch(() => {});

          const removed = await removeUser(chatId, identity);

          if (removed) {
            for (const k of keys) {
              advertencias[chatId][k] = 0;
            }

            fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));
          }
        } else {
          await sock.sendMessage(chatId, {
            text: `⚠️ @${identity.mentionNum}, no se permiten enlaces externos.\nAdvertencia: ${total}/10.`,
            mentions: [identity.mentionJid]
          }).catch(() => {});
        }

        return;
      }
    }
  }
} catch (e) {
  console.error("❌ Error final en lógica LINKALL:", e);
}
// === FIN DE LINKALL ===



// === INICIO BLOQUEO DE MENSAJES DE USUARIOS MUTEADOS ===
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

  const addZero = (n) => {
    const clean = DIGITS(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const cleanUserJid = (jid) => {
    const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
    return n ? `${n}@s.whatsapp.net` : null;
  };

  const cleanLidJid = (jid) => {
    const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
    return n ? `${n}@lid` : null;
  };

  const safeIsOwner = (value) => {
    try {
      if (typeof global.isOwner !== "function") return false;

      const raw = String(value || "");
      const num = DIGITS(raw);

      if (raw && global.isOwner(raw)) return true;
      if (num && global.isOwner(num)) return true;

      return false;
    } catch {
      return false;
    }
  };

  const chatId = m.key.remoteJid;
  const isGroup = typeof chatId === "string" && chatId.endsWith("@g.us");

  if (isGroup && !m.key.fromMe) {
    const senderRaw = m.key.participant || m.key.remoteJid;

    let senderRealJid = null;
    let senderLidJid = null;

    // PN real desde normalización principal
    if (isUser(m.realJid)) senderRealJid = cleanUserJid(m.realJid);
    if (isUser(senderRaw)) senderRealJid = cleanUserJid(senderRaw);

    // LID desde normalización principal
    if (isLid(m.realJid)) senderLidJid = cleanLidJid(m.realJid);
    if (isLid(m.realLid)) senderLidJid = cleanLidJid(m.realLid);
    if (isLid(senderRaw)) senderLidJid = cleanLidJid(senderRaw);

    // Intentar completar PN/LID desde global.lidMap
    try {
      if (global.lidMap instanceof Map) {
        if (senderLidJid && !senderRealJid) {
          const mappedPn = global.lidMap.get(senderLidJid);
          if (isUser(mappedPn)) senderRealJid = cleanUserJid(mappedPn);
        }

        if (senderRealJid && !senderLidJid) {
          const mappedLid = global.lidMap.get(senderRealJid);
          if (isLid(mappedLid)) senderLidJid = cleanLidJid(mappedLid);
        }
      }
    } catch {}

    // Intentar completar PN desde signalRepository si solo tenemos LID
    try {
      if (senderLidJid && !senderRealJid) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(senderLidJid);
        if (isUser(pn)) {
          senderRealJid = cleanUserJid(pn);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(senderLidJid, senderRealJid);
            global.lidMap.set(senderRealJid, senderLidJid);
          }
        }
      }
    } catch {}

    // Números posibles del usuario
    const pnNumber = senderRealJid ? DIGITS(senderRealJid) : "";
    const zeroNumber = pnNumber ? addZero(pnNumber) : "";
    const lidNumber = senderLidJid ? DIGITS(senderLidJid) : "";

    const senderNumbers = new Set();

    if (pnNumber) senderNumbers.add(pnNumber);
    if (zeroNumber && zeroNumber !== pnNumber) senderNumbers.add(zeroNumber);
    if (lidNumber && lidNumber !== pnNumber && lidNumber !== zeroNumber) senderNumbers.add(lidNumber);

    // Fallback por si msg.realNumber ya trae algo útil
    if (m.realNumber) {
      const rn = DIGITS(m.realNumber);
      if (rn) senderNumbers.add(rn);

      // Si realNumber viene de PN, esto ayuda con la versión +0
      if (isUser(m.realJid) || isUser(senderRaw)) {
        const rz = addZero(rn);
        if (rz && rz !== rn) senderNumbers.add(rz);
      }
    }

    // Último fallback
    const rawNum = DIGITS(senderRaw);
    if (rawNum) senderNumbers.add(rawNum);

    // Verificación owner robusta
    const isOwner =
      safeIsOwner(senderRaw) ||
      safeIsOwner(senderRealJid) ||
      safeIsOwner(senderLidJid) ||
      [...senderNumbers].some(n => safeIsOwner(n));

    if (!isOwner) {
      const welcomePath = path.resolve("setwelcome.json");

      let welcomeData = {};
      try {
        welcomeData = fs.existsSync(welcomePath)
          ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
          : {};
      } catch {
        welcomeData = {};
      }

      const mutedRaw = Array.isArray(welcomeData?.[chatId]?.muted)
        ? welcomeData[chatId].muted
        : [];

      // Soporta formatos nuevos y viejos:
      // nuevos: "507xxx", "507xxx0", "lidnumber"
      // viejos: "507xxx@s.whatsapp.net", "lid@lid"
      const mutedNums = new Set(
        mutedRaw
          .map(x => DIGITS(x))
          .filter(Boolean)
      );

      const isMuted = [...senderNumbers].some(n => mutedNums.has(n));

      if (isMuted) {
        global._muteCounter = global._muteCounter || {};

        const stableKey =
          pnNumber ||
          lidNumber ||
          DIGITS(senderRaw) ||
          String(senderRaw || "unknown");

        const counterKey = `${chatId}:${stableKey}`;
        global._muteCounter[counterKey] = (global._muteCounter[counterKey] || 0) + 1;

        const count = global._muteCounter[counterKey];

        const mentionJid =
          senderRealJid ||
          senderLidJid ||
          senderRaw;

        const mentionNum =
          pnNumber ||
          lidNumber ||
          DIGITS(senderRaw) ||
          "usuario";

        if (count === 8) {
          await sock.sendMessage(chatId, {
            text: `⚠️ @${mentionNum}, estás *muteado*. Si sigues enviando mensajes podrías ser eliminado.`,
            mentions: [mentionJid]
          }).catch(() => {});
        }

        if (count === 13) {
          await sock.sendMessage(chatId, {
            text: `⛔ @${mentionNum}, estás al *límite*. Un mensaje más y serás eliminado.`,
            mentions: [mentionJid]
          }).catch(() => {});
        }

        if (count >= 15) {
          let isAdmin = false;

          try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = Array.isArray(metadata?.participants)
              ? metadata.participants
              : [];

            for (const p of participants) {
              const adminFlag = p?.admin === "admin" || p?.admin === "superadmin";
              if (!adminFlag) continue;

              const ids = [
                p?.id,
                p?.jid,
                p?.lid,
                p?.pn,
                p?.phoneNumber,
                p?.jidAlt
              ].filter(x => typeof x === "string");

              const adminNums = new Set();

              for (const id of ids) {
                const d = DIGITS(id);
                if (d) adminNums.add(d);

                try {
                  if (isLid(id) && global.lidMap instanceof Map) {
                    const mapped = global.lidMap.get(id);
                    const md = DIGITS(mapped);
                    if (md) adminNums.add(md);

                    const md0 = addZero(md);
                    if (md0 && md0 !== md) adminNums.add(md0);
                  }
                } catch {}
              }

              if ([...senderNumbers].some(n => adminNums.has(n))) {
                isAdmin = true;
                break;
              }
            }
          } catch {}

          if (!isAdmin) {
            const removeJids = [
              senderRaw,
              senderRealJid,
              senderLidJid
            ].filter(Boolean);

            let removed = false;

            for (const jid of [...new Set(removeJids)]) {
              try {
                await sock.groupParticipantsUpdate(chatId, [jid], "remove");
                removed = true;
                break;
              } catch {}
            }

            if (removed) {
              await sock.sendMessage(chatId, {
                text: `❌ @${mentionNum} fue eliminado por ignorar el mute.`,
                mentions: [mentionJid]
              }).catch(() => {});

              delete global._muteCounter[counterKey];
            }
          } else {
            if (count === 15 || count % 10 === 0) {
              await sock.sendMessage(chatId, {
                text: `🔇 @${mentionNum} está muteado pero no puede ser eliminado por ser admin.`,
                mentions: [mentionJid]
              }).catch(() => {});
            }
          }
        }

        // Borrar mensaje. Prueba varias llaves por PN/LID porque Baileys v7 puede variar.
        const deleteKeys = [];

        deleteKeys.push(m.key);

        const possibleParticipants = [
          m.key.participant,
          senderRaw,
          senderLidJid,
          senderRealJid
        ].filter(Boolean);

        for (const participant of [...new Set(possibleParticipants)]) {
          deleteKeys.push({
            remoteJid: chatId,
            fromMe: false,
            id: m.key.id,
            participant
          });
        }

        for (const dk of deleteKeys) {
          try {
            await sock.sendMessage(chatId, { delete: dk });
            break;
          } catch {}
        }

        return;
      }
    }
  }
} catch (err) {
  console.error("❌ Error en lógica de muteo:", err);
}
// === FIN BLOQUEO DE MENSAJES DE USUARIOS MUTEADOS ===

// === INICIO BLOQUEO DE COMANDOS A USUARIOS BANEADOS ===
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

  const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

  const addZero = (n) => {
    const clean = DIGITS(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const cleanUserJid = (jid) => {
    const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
    return n ? `${n}@s.whatsapp.net` : null;
  };

  const cleanLidJid = (jid) => {
    const n = DIGITS(String(jid || "").split("@")[0].split(":")[0]);
    return n ? `${n}@lid` : null;
  };

  const safeIsOwner = (value) => {
    try {
      if (typeof global.isOwner !== "function") return false;

      const raw = String(value || "");
      const num = DIGITS(raw);

      if (raw && global.isOwner(raw)) return true;
      if (num && global.isOwner(num)) return true;

      return false;
    } catch {
      return false;
    }
  };

  const chatId = m.key.remoteJid;
  const senderRaw = m.key.participant || m.key.remoteJid;
  const isFromMe = !!m.key.fromMe;

  const messageText =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

  const prefixes = Array.isArray(global.prefixes)
    ? global.prefixes
    : [global.prefix || "."];

  const prefixUsed = prefixes.find((p) => {
    if (!p) return false;
    return messageText?.startsWith(String(p));
  });

  // Si no es comando, no hacemos nada.
  // OJO: aquí NO usamos return para no cortar otras lógicas del bot.
  if (prefixUsed) {
    let senderRealJid = null;
    let senderLidJid = null;

    // PN real desde la normalización principal
    if (isUser(m.realJid)) senderRealJid = cleanUserJid(m.realJid);
    if (isUser(senderRaw)) senderRealJid = cleanUserJid(senderRaw);

    // LID desde la normalización principal
    if (isLid(m.realJid)) senderLidJid = cleanLidJid(m.realJid);
    if (isLid(m.realLid)) senderLidJid = cleanLidJid(m.realLid);
    if (isLid(senderRaw)) senderLidJid = cleanLidJid(senderRaw);

    // Completar PN/LID usando global.lidMap
    try {
      if (global.lidMap instanceof Map) {
        if (senderLidJid && !senderRealJid) {
          const mappedPn = global.lidMap.get(senderLidJid);
          if (isUser(mappedPn)) senderRealJid = cleanUserJid(mappedPn);
        }

        if (senderRealJid && !senderLidJid) {
          const mappedLid = global.lidMap.get(senderRealJid);
          if (isLid(mappedLid)) senderLidJid = cleanLidJid(mappedLid);
        }
      }
    } catch {}

    // Completar PN desde signalRepository si solo tenemos LID
    try {
      if (senderLidJid && !senderRealJid) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(senderLidJid);
        if (isUser(pn)) {
          senderRealJid = cleanUserJid(pn);

          if (global.lidMap instanceof Map) {
            global.lidMap.set(senderLidJid, senderRealJid);
            global.lidMap.set(senderRealJid, senderLidJid);
          }
        }
      }
    } catch {}

    const pnNumber = senderRealJid ? DIGITS(senderRealJid) : "";
    const zeroNumber = pnNumber ? addZero(pnNumber) : "";
    const lidNumber = senderLidJid ? DIGITS(senderLidJid) : "";

    const senderNumbers = new Set();

    if (pnNumber) senderNumbers.add(pnNumber);
    if (zeroNumber && zeroNumber !== pnNumber) senderNumbers.add(zeroNumber);
    if (lidNumber && lidNumber !== pnNumber && lidNumber !== zeroNumber) senderNumbers.add(lidNumber);

    // Fallback desde m.realNumber
    if (m.realNumber) {
      const rn = DIGITS(m.realNumber);
      if (rn) senderNumbers.add(rn);

      if (isUser(m.realJid) || isUser(senderRaw)) {
        const rz = addZero(rn);
        if (rz && rz !== rn) senderNumbers.add(rz);
      }
    }

    // Último fallback
    const rawNum = DIGITS(senderRaw);
    if (rawNum) senderNumbers.add(rawNum);

    const isOwner =
      safeIsOwner(senderRaw) ||
      safeIsOwner(senderRealJid) ||
      safeIsOwner(senderLidJid) ||
      [...senderNumbers].some(n => safeIsOwner(n));

    const welcomePath = path.resolve("./setwelcome.json");

    let welcomeData = {};
    try {
      welcomeData = fs.existsSync(welcomePath)
        ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
        : {};
    } catch {
      welcomeData = {};
    }

    const chatBanList = Array.isArray(welcomeData?.[chatId]?.banned)
      ? welcomeData[chatId].banned
      : [];

    // Soporta formato nuevo y viejo:
    // nuevo: "507xxx", "507xxx0", "lidnumber"
    // viejo: "507xxx@s.whatsapp.net", "xxx@lid"
    const bannedNums = new Set(
      chatBanList
        .map(x => DIGITS(x))
        .filter(Boolean)
    );

    const isBanned = [...senderNumbers].some(n => bannedNums.has(n));

    if (isBanned && !isOwner && !isFromMe) {
      const mentionJid =
        senderRealJid ||
        senderLidJid ||
        senderRaw;

      const mentionNum =
        pnNumber ||
        lidNumber ||
        DIGITS(senderRaw) ||
        "usuario";

      const frases = [
        "🚫 @usuario estás baneado por pendejo. ¡Abusaste demasiado del bot!",
        "❌ Lo siento @usuario, pero tú ya no puedes usarme. Aprende a comportarte.",
        "🔒 No tienes permiso @usuario. Fuiste baneado por molestar mucho.",
        "👎 ¡Bloqueado! @usuario abusaste del sistema y ahora no puedes usarme.",
        "😤 Quisiste usarme pero estás baneado, @usuario. Vuelve en otra vida."
      ];

      const texto = frases[Math.floor(Math.random() * frases.length)]
        .replace("@usuario", `@${mentionNum}`);

      await sock.sendMessage(chatId, {
        text: texto,
        mentions: [mentionJid]
      }, { quoted: m });

      return; // evita que el comando continúe
    }
  }
} catch (e) {
  console.error("❌ Error procesando bloqueo de usuarios baneados:", e);
}
// === FIN BLOQUEO DE COMANDOS A USUARIOS BANEADOS ===

// === 🔐 INICIO FILTRO PRIVADO + MODO PRIVADO GLOBAL CORREGIDO ===
try {

  const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

  function jidText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;

    return String(
      value.id ||
      value.jid ||
      value.lid ||
      value.user ||
      value._serialized ||
      ""
    );
  }

  function normalizeOwnerList() {
    if (Array.isArray(global.owner)) return global.owner;
    return [];
  }

  function isOwnerNumber(number) {
    const clean = DIGITS(number);
    if (!clean) return false;

    if (typeof global.isOwner === "function") {
      try {
        if (global.isOwner(clean)) return true;
        if (global.isOwner(clean + "@s.whatsapp.net")) return true;
      } catch {}
    }

    return normalizeOwnerList().some((entry) => {
      if (Array.isArray(entry)) {
        return entry.some((x) => DIGITS(x) === clean);
      }

      return DIGITS(entry) === clean;
    });
  }

  function readPrivateWhitelist() {
    try {
      const welcomePath = path.resolve("setwelcome.json");

      if (!fs.existsSync(welcomePath)) return [];

      const raw = fs.readFileSync(welcomePath, "utf-8");
      if (!raw.trim()) return [];

      const data = JSON.parse(raw);
      const lista = Array.isArray(data.lista) ? data.lista : [];

      return lista
        .map((x) => DIGITS(x))
        .filter(Boolean);
    } catch (e) {
      console.log("⚠️ No se pudo leer setwelcome.json:", e.message);
      return [];
    }
  }

  const chatId = jidText(m?.key?.remoteJid);

  if (!chatId) {
    console.log("⛔ Mensaje ignorado: remoteJid vacío.");
    return;
  }

  const isGroup = chatId.endsWith("@g.us");

  const botRaw = jidText(sock?.user?.id || sock?.user?.jid || "");
  const botNumber = DIGITS(String(botRaw).split(":")[0].split("@")[0]);
  const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : "";

  const fromMe = m?.key?.fromMe === true;

  const senderId = isGroup
    ? jidText(m?.key?.participant || m?.participant || m?.sender || "")
    : fromMe
      ? botJid
      : jidText(m?.key?.remoteJid || m?.sender || "");

  const senderNum = DIGITS(String(senderId).split(":")[0]);

  const isBot = fromMe || (!!botNumber && senderNum === botNumber);
  const isOwner = isOwnerNumber(senderNum);

  const whitelistNums = readPrivateWhitelist();
  const isInPrivateWhitelist = whitelistNums.includes(senderNum);

  let modoPrivado = 0;

  try {
    modoPrivado = await getConfig("global", "modoprivado");
  } catch (e) {
    modoPrivado = 0;
  }

  const modoPrivadoActivo =
    modoPrivado === 1 ||
    String(modoPrivado || "").trim() === "1" ||
    String(modoPrivado || "").toLowerCase() === "on" ||
    String(modoPrivado || "").toLowerCase() === "true";

  /*
    ✅ PRIVADO:
    El bot solo responde a:
    - El mismo bot
    - Owners
    - Usuarios en setwelcome.json -> lista

    Esto aplica aunque modoprivado esté apagado.
  */
  if (!isGroup) {
    const permitidoPrivado = isBot || isOwner || isInPrivateWhitelist;

    if (!permitidoPrivado) {
      console.log("⛔ PRIVADO BLOQUEADO");
      console.log("➡️ Sender:", senderId || "vacío");
      console.log("➡️ Número:", senderNum || "vacío");
      console.log("➡️ Owner:", isOwner);
      console.log("➡️ Lista privada:", isInPrivateWhitelist);
      return;
    }
  }

  /*
    ✅ GRUPOS + MODO PRIVADO GLOBAL:
    Si modoprivado está activo, en grupos solo responde a:
    - El mismo bot
    - Owners

    En privado NO bloquea a los de la lista.
  */
  if (isGroup && modoPrivadoActivo) {
    const permitidoGrupo = isBot || isOwner;

    if (!permitidoGrupo) {
      console.log("⛔ GRUPO BLOQUEADO POR MODO PRIVADO GLOBAL");
      console.log("➡️ Grupo:", chatId);
      console.log("➡️ Sender:", senderId || "vacío");
      console.log("➡️ Número:", senderNum || "vacío");
      console.log("➡️ Owner:", isOwner);
      return;
    }
  }

} catch (e) {
  console.error("❌ Error en filtro privado/modoprivado:", e);
}
// === ✅ FIN FILTRO PRIVADO + MODO PRIVADO GLOBAL CORREGIDO ===


  
// === ✅ INICIO LÓGICA DE APAGADO POR GRUPO (solo responde al dueño) ===
try {

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isGroup = chatId.endsWith("@g.us");
  const isOwner = global.owner.some(([id]) => id === senderNum);

  if (isGroup) {
    const apagado = await getConfig(chatId, "apagado");

    if (apagado == 1 && !isOwner) {
      return; // 👈 Si está apagado y no es owner, ignorar mensaje
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de apagado por grupo:", e);
}
// === ✅ FIN LÓGICA DE APAGADO POR GRUPO ===  
// === INICIO BLOQUEO DE COMANDOS RESTRINGIDOS POR GRUPO ===
try {

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isOwner = global.isOwner(senderId);
  const isBot = senderId === sock.user.id;
  const isFromMe = m.key.fromMe;

  const messageText =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

  const prefixUsed = global.prefixes.find(p => messageText.startsWith(p));
  if (!prefixUsed) return;

  const command = messageText.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();

  const welcomePath = path.resolve("setwelcome.json");
  const welcomeData = fs.existsSync(welcomePath)
    ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
    : {};

  const restringidos = welcomeData[chatId]?.restringidos || [];

  if (restringidos.includes(command)) {
    if (!isOwner && !isFromMe && !isBot) {
      global.reintentosRestrict = global.reintentosRestrict || {};
      const key = `${chatId}:${senderId}:${command}`;
      global.reintentosRestrict[key] = (global.reintentosRestrict[key] || 0) + 1;

      const intentos = global.reintentosRestrict[key];

      if (intentos <= 2) {
        await sock.sendMessage(chatId, {
          text: `🚫 *Este comando está restringido en este grupo.*\nSolo el *dueño del bot* y el *bot* pueden usarlo.`,
          quoted: m
        });
      }

      if (intentos === 3) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${senderNum} *este es tu intento 3* usando un comando restringido.\n💥 Si lo haces *una vez más*, serás *ignorado para este comando*.`,
          mentions: [senderId],
          quoted: m
        });
      }

      if (intentos >= 4) {
        console.log(`🔇 Ignorando a ${senderId} para el comando restringido: ${command}`);
        return;
      }

      return; // ← cortar ejecución del comando
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de comandos restringidos:", e);
}
// === FIN BLOQUEO DE COMANDOS RESTRINGIDOS POR GRUPO ===


// 🔐 VERIFICACIÓN MODOADMINS (compatible LID y NO-LID)
if (isGroup) {
  try {
    const estadoModoAdmins = await getConfig(chatId, "modoadmins");
    if (parseInt(estadoModoAdmins) === 1) {

      // Número real del sender (prioriza realNumber del normalizador del index)
      const senderNum = String(
        m.realNumber ||
        (m.realJid ? m.realJid.split(":")[0].replace(/[^0-9]/g, "") : "") ||
        sender.replace(/[^0-9]/g, "")
      );

      const isOwner = Array.isArray(global.owner) &&
        global.owner.some(function(entry) {
          var n = Array.isArray(entry) ? entry[0] : entry;
          return String(n).replace(/[^0-9]/g, "") === senderNum;
        });

      let isAdmin = false;
      try {
        const meta = await sock.groupMetadata(chatId);
        const rawParts = Array.isArray(meta && meta.participants) ? meta.participants : [];

        const adminNums = new Set();

        for (var i = 0; i < rawParts.length; i++) {
          var p = rawParts[i];
          var flagAdmin = p.admin === "admin" || p.admin === "superadmin";
          if (!flagAdmin) continue;

          var pid  = String(p.id  || "");
          var pjid = String(p.jid || "");

          // 1) Si es @s.whatsapp.net — extraer dígitos directamente
          if (pid.endsWith("@s.whatsapp.net")) {
            adminNums.add(pid.split(":")[0].replace(/[^0-9]/g, ""));
          }
          if (pjid.endsWith("@s.whatsapp.net")) {
            adminNums.add(pjid.split(":")[0].replace(/[^0-9]/g, ""));
          }

          // 2) Si es @lid — resolver con lidMap global
          if (pid.endsWith("@lid") && global.lidMap instanceof Map) {
            var resolved = global.lidMap.get(pid);
            if (resolved && resolved.endsWith("@s.whatsapp.net")) {
              adminNums.add(resolved.split(":")[0].replace(/[^0-9]/g, ""));
            }
          }
          if (pjid.endsWith("@lid") && global.lidMap instanceof Map) {
            var resolved2 = global.lidMap.get(pjid);
            if (resolved2 && resolved2.endsWith("@s.whatsapp.net")) {
              adminNums.add(resolved2.split(":")[0].replace(/[^0-9]/g, ""));
            }
          }

          // 3) lidParser como fallback adicional
          if (typeof sock.lidParser === "function") {
            var normed = sock.lidParser([p]);
            if (normed && normed[0]) {
              var nid = String(normed[0].id || "");
              if (nid.endsWith("@s.whatsapp.net")) {
                adminNums.add(nid.split(":")[0].replace(/[^0-9]/g, ""));
              }
            }
          }
        }

        isAdmin = adminNums.has(senderNum);

        // Debug (quitar cuando funcione)
        console.log("[modoAdmins] senderNum:", senderNum);
        console.log("[modoAdmins] adminNums:", Array.from(adminNums));
        console.log("[modoAdmins] isAdmin:", isAdmin, "| isOwner:", isOwner);

      } catch (e) {
        console.error("[modoAdmins] error leyendo metadata:", e);
      }

      if (!isAdmin && !isOwner && !fromMe) return;
    }
  } catch (e) {
    console.error("❌ Error verificando modoAdmins:", e);
    return;
  }
}


  

  
  // 🧩 Detectar prefijo
  const prefixUsed = global.prefixes.find(p => messageContent.startsWith(p));
  if (!prefixUsed) return;
  
  const command = messageContent.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();
  const rawArgs = messageContent.trim().slice(prefixUsed.length + command.length).trim();
  const args = rawArgs.length ? rawArgs.split(/\s+/) : [];
  // 🔁 Ejecutar comando desde plugins (despacho O(1) por índice, con
  // fallback al recorrido clásico por si el índice aún no se construyó)
  let plugin = global.pluginIndex?.get?.(command);
  if (!plugin) {
    plugin = global.plugins.find(p => p?.command?.includes?.(command));
  }
  if (plugin) {
    try {
      if (typeof plugin === "function") {
        await plugin(m, { conn: sock, text: rawArgs, args, command });
      } else if (typeof plugin.run === "function") {
        await plugin.run({ msg: m, conn: sock, args, command });
      }
    } catch (e) {
      console.error(chalk.red(`❌ Error ejecutando ${command}:`), e);
    }
  }
});

sock.ev.on("connection.update", async ({ connection }) => {
  if (connection === "open") {
    console.log(chalk.green("✅ Conectado correctamente a WhatsApp."));

    // ✔️ Si fue reiniciado con .carga, avisar
    const restarterFile = "./lastRestarter.json";
    if (fs.existsSync(restarterFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(restarterFile, "utf-8"));
        if (data.chatId) {
          await sock.sendMessage(data.chatId, {
            text: "✅ *Suki Bot 3.0 está en línea nuevamente* 🚀"
          });
          console.log(chalk.yellow("📢 Aviso enviado al grupo del reinicio."));
          fs.unlinkSync(restarterFile); // 🧹 Eliminar archivo tras el aviso
        }
      } catch (error) {
        console.error("❌ Error leyendo lastRestarter.json:", error);
      }
    }

  } else if (connection === "close") {
    console.log(chalk.red("❌ Conexión cerrada. Reintentando en 5 segundos..."));
    setTimeout(startBot, 5000);
  }
});

      sock.ev.on("creds.update", saveCreds);

      process.on("uncaughtException", (err) => {
        console.error(chalk.red("⚠️ Error no capturado:"), err);
      });

      process.on("unhandledRejection", (reason, promise) => {
        console.error(chalk.red("🚨 Promesa sin manejar:"), promise, "Razón:", reason);
      });

    } catch (e) {
      console.error(chalk.red("❌ Error en conexión:"), e);
      setTimeout(startBot, 5000);
    }
  }

  startBot();
})();
