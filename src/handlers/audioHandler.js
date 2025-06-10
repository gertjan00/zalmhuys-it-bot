// src/handlers/audioHandler.js
const telegram = require("../lib/telegramClient");

async function handle(msg) {
  const chatId = msg.chat.id;
  const audio = msg.audio;

  console.log(
    `[AudioHandler - Chat ${chatId}] Audio ontvangen (file_id: ${audio.file_id}, duration: ${audio.duration}s)`
  );

  try {
    await telegram.sendMessage(
      chatId,
      `Audio Handler succesvol aangeroepen. Functionaliteit voor audioverwerking nog niet geïmplementeerd.`
    );
  } catch (e) {
    console.error(
      `[AudioHandler - Chat ${chatId}] Fout bij sturen placeholder bericht:`,
      e.message
    );
  }
}

module.exports = {
  handle,
};
