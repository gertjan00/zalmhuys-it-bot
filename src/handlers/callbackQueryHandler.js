// src/handlers/callbackQueryHandler.js
const telegram = require("../lib/telegramClient");

async function handle(callbackQuery) {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const data = callbackQuery.data;

  console.log(`[CallbackQueryHandler - Chat ${chatId}] Callback query data: ${data}`);
  await telegram.answerCallbackQuery(callbackQuery.id, { text: "Keuze ontvangen!" });

  try {
    await telegram.sendMessage(
      chatId,
      `Callback Query Handler succesvol aangeroepen met data: '${data}'. Functionaliteit nog niet geïmplementeerd.`
    );
  } catch (e) {
    console.error(
      `[CallbackQueryHandler - Chat ${chatId}] Fout bij sturen placeholder bericht:`,
      e.message
    );
  }
}

module.exports = {
  handle,
};
