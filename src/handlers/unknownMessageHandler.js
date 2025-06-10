// src/handlers/unknownMessageHandler.js
const telegram = require("../lib/telegramClient");

async function handle(msg) {
  const chatId = msg.chat.id;

  console.warn(
    `[UnknownMessageHandler - Chat ${chatId}] Onbekend berichttype ontvangen. Msg:`,
    msg
  );

  try {
    await telegram.sendMessage(chatId, "Sorry, ik begrijp dit type bericht nog niet.");
  } catch (e) {
    console.error(
      `[UnknownMessageHandler - Chat ${chatId}] Fout bij sturen placeholder bericht:`,
      e.message
    );
  }
}

module.exports = {
  handle,
};
