// src/handlers/imageHandler.js
const telegram = require("../lib/telegramClient");

async function handle(msg) {
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1]; // Neem de grootste resolutie

  console.log(`[ImageHandler - Chat ${chatId}] Afbeelding ontvangen (file_id: ${photo.file_id})`);

  try {
    await telegram.sendMessage(
      chatId,
      `Image Handler succesvol aangeroepen. Functionaliteit voor afbeeldingsverwerking nog niet geïmplementeerd.`
    );
  } catch (e) {
    console.error(
      `[ImageHandler - Chat ${chatId}] Fout bij sturen placeholder bericht:`,
      e.message
    );
  }
}

module.exports = {
  handle,
};
