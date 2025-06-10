// src/handlers/commandHandler.js
const telegram = require("../lib/telegramClient");

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || "daar";
  // Optioneel: reset de Langchain chain cache voor deze chat.
  // Dit zou een functie in langchainClient kunnen zijn: langchainClient.resetChatCache(chatId);
  console.log(`[CommandHandler - Chat ${chatId}] /start commando ontvangen van ${userName}`);
  try {
    await telegram.sendMessage(
      chatId,
      `Hallo ${userName}! Ik ben de Zalmhuys IT Bot. Stel je vraag.`
    );
  } catch (e) {
    console.error(`[CommandHandler - Chat ${chatId}] Fout bij sturen /start bericht:`, e.message);
  }
}

// Hier kun je andere command handlers toevoegen
// async function handleHelp(msg) { ... }

module.exports = {
  handleStart,
  // handleHelp,
};
