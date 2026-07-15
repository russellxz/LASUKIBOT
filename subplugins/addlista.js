// subplugins/addlista.js — Agrega/quita números para que el subbot les responda
// en PRIVADO. Usa la misma lógica LID del bot principal (guarda número real,
// variante con 0 y número LID). Guardado en subbots/data/<numero>/lista.json
// 🚫 Solo lo puede usar el mismo subbot (su propio número)
const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = String(senderId).replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botNumber = String(conn.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
  const isBot = fromMe || senderNum === botNumber;
  const p = conn?.subPrefixes?.[0] || ".";

  function onlyDigits(s) {
    return String(s || "").replace(/[^0-9]/g, "");
  }

  function isUserJid(j) {
    return typeof j === "string" && j.endsWith("@s.whatsapp.net");
  }

  function isLidJid(j) {
    return typeof j === "string" && j.endsWith("@lid");
  }

  function addZero(n) {
    var clean = onlyDigits(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  }

  function getContextInfo() {
    var mm = msg.message || {};
    return (
      (mm.extendedTextMessage && mm.extendedTextMessage.contextInfo) ||
      (mm.imageMessage && mm.imageMessage.contextInfo) ||
      (mm.videoMessage && mm.videoMessage.contextInfo) ||
      (mm.documentMessage && mm.documentMessage.contextInfo) ||
      (mm.audioMessage && mm.audioMessage.contextInfo) ||
      (mm.stickerMessage && mm.stickerMessage.contextInfo) ||
      null
    );
  }

  function getQuotedParticipant() {
    var ctx = getContextInfo();
    return ctx && typeof ctx.participant === "string" ? ctx.participant : "";
  }

  function getMentioned() {
    var ctx = getContextInfo();
    var arr = ctx && Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
    return arr.length ? arr[0] : "";
  }

  async function resolveLidFromPn(pnJid) {
    try {
      if (conn.signalRepository && conn.signalRepository.lidMapping && conn.signalRepository.lidMapping.getLIDForPN) {
        var lid = await conn.signalRepository.lidMapping.getLIDForPN(pnJid);
        if (isLidJid(lid)) return lid;
      }
    } catch (e) {}

    try {
      if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
        var lid2 = global.lidMap.get(pnJid);
        if (isLidJid(lid2)) return lid2;
      }
    } catch (e) {}

    try {
      if (chatId.endsWith("@g.us") && conn.groupMetadata) {
        var meta = await conn.groupMetadata(chatId);
        var participants = Array.isArray(meta && meta.participants) ? meta.participants : [];

        for (var i = 0; i < participants.length; i++) {
          var pt = participants[i];
          var pid = typeof pt.id === "string" ? pt.id : "";
          var pjid = typeof pt.jid === "string" ? pt.jid : "";
          var real = isUserJid(pid) ? pid : (isUserJid(pjid) ? pjid : null);
          var lidc = isLidJid(pid) ? pid : (isLidJid(pjid) ? pjid : null);
          if (real === pnJid && lidc) return lidc;
        }
      }
    } catch (e) {}

    return null;
  }

  async function resolvePnFromLid(lidJid) {
    try {
      if (conn.signalRepository && conn.signalRepository.lidMapping && conn.signalRepository.lidMapping.getPNForLID) {
        var pn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
        if (isUserJid(pn)) return pn;
      }
    } catch (e) {}

    try {
      if (global.resolveRealJidAsync) {
        var pn2 = await global.resolveRealJidAsync(lidJid);
        if (isUserJid(pn2)) return pn2;
      }
    } catch (e) {}

    return null;
  }

  if (!isBot) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo el *dueño del subbot* (el mismo número conectado) puede usar este comando."
    }, { quoted: msg });
  }

  var baseNumber = args[0] ? onlyDigits(args[0]) : "";
  var zeroNumber = baseNumber ? addZero(baseNumber) : "";
  var lidNumber = "";

  var mencionado = getMentioned();
  var quotedParticipant = getQuotedParticipant();
  var refJid = mencionado || (!baseNumber ? quotedParticipant : "");

  if (!baseNumber && refJid) {
    if (isLidJid(refJid)) {
      lidNumber = onlyDigits(refJid.split("@")[0].split(":")[0]);
      var pnResolved = await resolvePnFromLid(refJid);
      if (pnResolved) {
        baseNumber = onlyDigits(pnResolved.split("@")[0].split(":")[0]);
        zeroNumber = addZero(baseNumber);
      }
    } else {
      baseNumber = onlyDigits(refJid.split("@")[0].split(":")[0]);
      zeroNumber = addZero(baseNumber);
    }
  }

  if (!lidNumber && baseNumber) {
    var tryJids = [];
    if (baseNumber) tryJids.push(baseNumber + "@s.whatsapp.net");
    if (zeroNumber && zeroNumber !== baseNumber) tryJids.push(zeroNumber + "@s.whatsapp.net");

    for (var j = 0; j < tryJids.length; j++) {
      var foundLid = await resolveLidFromPn(tryJids[j]);
      if (foundLid) {
        lidNumber = onlyDigits(foundLid.split("@")[0].split(":")[0]);
        break;
      }
    }
  }

  if (!baseNumber && !zeroNumber && !lidNumber) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Debes escribir el número, mencionar o responder al mensaje del usuario.*\n\nEj: *${p}${command} +507 6123-4567*`
    }, { quoted: msg });
  }

  var variantes = [];
  if (baseNumber) variantes.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) variantes.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) variantes.push(lidNumber);

  var lista = conn.readSubData("lista.json", []);
  if (!Array.isArray(lista)) lista = [];
  lista = lista.map(onlyDigits).filter(Boolean);

  if (command === "addlista") {
    var agregados = [];
    var yaExistian = [];
    var mentions = [];

    for (var k = 0; k < variantes.length; k++) {
      var num = variantes[k];
      if (lista.indexOf(num) === -1) {
        lista.push(num);
        agregados.push(num);
        mentions.push(num + "@s.whatsapp.net");
      } else {
        yaExistian.push(num);
      }
    }

    if (agregados.length === 0) {
      return conn.sendMessage(chatId, {
        text: "⚠️ Todos los números ya están en la lista.\n\n📌 Detectados:\n" +
          variantes.map(function (v) { return "• " + v; }).join("\n")
      }, { quoted: msg });
    }

    conn.writeSubData("lista.json", lista);

    var texto = "✅ Agregado a la lista de privados correctamente.\n" +
      "🤖 El subbot ahora le responderá en *privado*.\n\n" +
      "📌 Guardados nuevos:\n" +
      agregados.map(function (v) { return "• @" + v; }).join("\n");

    if (yaExistian.length > 0) {
      texto += "\n\nℹ️ Ya existían:\n" +
        yaExistian.map(function (v) { return "• " + v; }).join("\n");
    }

    texto += `\n\n✖️ Para quitarlo: *${p}dellista +${baseNumber || variantes[0]}*`;

    return conn.sendMessage(chatId, {
      text: texto,
      mentions: mentions
    }, { quoted: msg });
  }

  // ===== dellista =====
  var eliminados = [];
  var noEncontrados = [];

  for (var d = 0; d < variantes.length; d++) {
    var numDel = variantes[d];
    if (lista.indexOf(numDel) !== -1) {
      lista = lista.filter(function (id) { return id !== numDel; });
      eliminados.push(numDel);
    } else {
      noEncontrados.push(numDel);
    }
  }

  if (eliminados.length === 0) {
    return conn.sendMessage(chatId, {
      text: "⚠️ Ninguno de esos números estaba en la lista.\n\n📌 Buscados:\n" +
        variantes.map(function (v) { return "• " + v; }).join("\n")
    }, { quoted: msg });
  }

  conn.writeSubData("lista.json", lista);

  var mentionsDel = eliminados.map(function (v) { return v + "@s.whatsapp.net"; });

  var textoDel = "🗑️ Eliminado de la lista correctamente.\n\n📌 Eliminados:\n" +
    eliminados.map(function (v) { return "• @" + v; }).join("\n");

  if (noEncontrados.length > 0) {
    textoDel += "\n\nℹ️ No estaban en la lista:\n" +
      noEncontrados.map(function (v) { return "• " + v; }).join("\n");
  }

  return conn.sendMessage(chatId, {
    text: textoDel,
    mentions: mentionsDel
  }, { quoted: msg });
};

handler.command = ["addlista", "dellista"];
export default handler;
