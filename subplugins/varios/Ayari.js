"use strict";

import crypto from 'crypto';

const AYARI_STEPS = [
  {
    type: "text",
    text: `🌸✨ Hola, *Ayari*... tu novio *Russell* quiere decirte algo muy especial. 💌

🎂💕 Hoy es un día hermoso porque celebras tu cumpleaños, mi amor.

👆 Presiona el botón de abajo para ver el siguiente mensajito.`
  },
  {
    type: "text",
    text: `🎉🎂 Hola, amor.

💖 Te deseo un *feliz cumpleaños*, bebé. Aunque no pueda estar contigo en persona, quiero dedicarte unas palabras muy especiales.

🥹💕 Te amo muchísimo, mi bebé. Pásala hermoso en tu día, disfrútalo mucho y sigue viendo lo que preparé para ti. ✨`
  },
  {
    type: "image",
    url: "https://cdn.russellxz.click/db0393ad.jpg",
    caption: `🫶🎮 Sé que, aunque solo sea un avatar dentro del juego, cuando nos miramos de frente te siento cerca de mí.

💞 Siento que conecto contigo, así como nuestros avatares también conectan.

🥰 Te amo, bebé.`
  },
  {
    type: "image",
    url: "https://cdn.russellxz.click/2b3aa183.jpg",
    caption: `🤗💕 Un abrazo tuyo en el juego es lo más real y cercano que siento.

✨ Simplemente se siente bonito, se siente bien, y me hace feliz.

💘 Te amo.`
  },
  {
    type: "image",
    url: "https://cdn.russellxz.click/ba920439.jpg",
    caption: `🫂💗 Cuando estemos juntos en persona, siempre te voy a cargar así.

🥹💕 Me hace mucha ilusión cargarte como a mi bebé hermosa.

🌷 Te amo muchísimo, amor.`
  },
  {
    type: "image",
    url: "https://cdn.russellxz.click/860557c7.jpg",
    caption: `😍🌸 Mírate, bebé... eres tan hermosa. No te cambiaría por nada; sería muy tonto si lo hiciera, porque la verdad me encantas tal y como eres.

💖 Estoy solo para ti. Eres quien me da ánimos todos los días para seguir adelante. Mi motivación eres tú.

✨ Gracias por todo, amor. Te amo muchísimo.`
  },
  {
    type: "text",
    text: `💌🌹 Hola, amor... eso fue todo lo que quería decirte hoy.

🥹💕 Te amo, bebé, y siempre estaré para ti.

🎂✨ Feliz cumpleaños, mi vida. Nunca olvides lo especial que eres para mí. 💖`
  }
];

const sessions = Object.create(null);

function makeId() {
  return crypto.randomBytes(5).toString("hex");
}

async function safeReact(conn, chatId, key, text) {
  try {
    await conn.sendMessage(chatId, { react: { text, key } });
  } catch {}
}

function buildButton(stepIndex, sessionId) {
  const isLast = stepIndex >= AYARI_STEPS.length - 1;
  const text = isLast
    ? "💖 Final"
    : (stepIndex === 0
      ? "💌 Ver mensaje"
      : (stepIndex === AYARI_STEPS.length - 2 ? "🌷 Ver último" : "➡️ Siguiente"));

  return [{ text, id: `ayari_next:${sessionId}:${stepIndex}` }];
}

async function sendStep(conn, chatId, quoted, sessionId, stepIndex) {
  const step = AYARI_STEPS[stepIndex];
  if (!step) return;

  const isLast = stepIndex >= AYARI_STEPS.length - 1;
  const buttons = !isLast ? buildButton(stepIndex, sessionId) : undefined;
  const footer = !isLast ? "❦ Un detalle bonito de Russell para Ayari ❦" : undefined;

  if (step.type === "image") {
    if (buttons) {
      try {
        return await conn.sendMessage(chatId, {
          image: { url: step.url },
          caption: step.caption,
          footer,
          buttons,
          headerType: 4
        }, { quoted });
      } catch {}
    }

    return await conn.sendMessage(chatId, {
      image: { url: step.url },
      caption: step.caption
    }, { quoted });
  }

  if (buttons) {
    try {
      return await conn.sendMessage(chatId, {
        text: step.text,
        footer,
        buttons
      }, { quoted });
    } catch {}
  }

  return await conn.sendMessage(chatId, { text: step.text }, { quoted });
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const sessionId = makeId();

  sessions[sessionId] = {
    chatId,
    ownerJid: msg.key.participant || msg.key.remoteJid,
    step: 0,
    createdAt: Date.now()
  };

  setTimeout(() => {
    delete sessions[sessionId];
  }, 30 * 60 * 1000);

  await safeReact(conn, chatId, msg.key, "🎂");
  await sendStep(conn, chatId, msg, sessionId, 0);

  if (!conn._ayariListener) {
    conn._ayariListener = true;

    conn.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages || []) {
        try {
          if (!m.message) continue;
          const chat = m.key.remoteJid;

          let selectedId = "";
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            m.message?.listResponseMessage ||
            null;

          if (m.message?.buttonsResponseMessage?.selectedButtonId) {
            selectedId = m.message.buttonsResponseMessage.selectedButtonId;
          } else if (m.message?.templateButtonReplyMessage?.selectedId) {
            selectedId = m.message.templateButtonReplyMessage.selectedId;
          } else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
            selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
          } else if (interactiveReply?.paramsJson) {
            try {
              const params = JSON.parse(interactiveReply.paramsJson);
              selectedId = params.id || "";
            } catch {}
          } else if (interactiveReply?.body?.text) {
            selectedId = interactiveReply.body.text;
          }

          if (!selectedId || !String(selectedId).startsWith("ayari_next:")) continue;

          const [, sessionId, stepIndexRaw] = String(selectedId).split(":");
          const session = sessions[sessionId];
          if (!session) continue;
          if (session.chatId !== chat) continue;

          const senderJid = m.key.participant || m.key.remoteJid;
          if (senderJid !== session.ownerJid) continue;

          const currentStep = Number(stepIndexRaw);
          if (!Number.isInteger(currentStep)) continue;

          const nextStep = currentStep + 1;
          if (!AYARI_STEPS[nextStep]) continue;

          session.step = nextStep;
          await safeReact(conn, chat, m.key, "💖");
          await sendStep(conn, chat, m, sessionId, nextStep);

          if (nextStep >= AYARI_STEPS.length - 1) {
            delete sessions[sessionId];
          }
        } catch (e) {
          console.error("Ayari listener error:", e);
        }
      }
    });
  }
};

handler.command = ["ayari"];
handler.help = ["ayari"];
handler.tags = ["fun"];
handler.register = true;

export default handler;
