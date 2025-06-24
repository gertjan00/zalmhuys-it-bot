// src/server.js
require("./bootstrap.js");
require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

console.log("=======================\nZalmhuys IT Bot wordt gestart...");

const telegram = require("./lib/telegramClient");
require("./lib/supabaseClient");
require("./lib/langchainClient");
require("./lib/notionClient.js");

const textMessageHandler = require("./handlers/textMessageHandler");
const commandHandler = require("./handlers/commandHandler");
const callbackQueryHandler = require("./handlers/callbackQueryHandler");
const imageHandler = require("./handlers/imageHandler");
const audioHandler = require("./handlers/audioHandler");
const unknownMessageHandler = require("./handlers/unknownMessageHandler");

console.log("Zalmhuys IT bot luistert nu naar berichten.");

telegram.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (msg.text && msg.text.startsWith("/")) {
    if (msg.text.startsWith("/start")) {
      await commandHandler.handleStart(msg);
    } else {
      console.log(`[ServerRouter - Chat ${chatId}] Onbekend commando: ${msg.text}`);
      try {
        await telegram.sendMessage(chatId, `Onbekend commando: ${msg.text}`);
      } catch (e) {}
    }
    return;
  }

  if (msg.text) {
    await textMessageHandler.handle(msg);
  } else if (msg.photo) {
    await imageHandler.handle(msg);
  } else if (msg.audio) {
    await audioHandler.handle(msg);
  } else {
    await unknownMessageHandler.handle(msg);
  }
});

telegram.on("callback_query", async (callbackQuery) => {
  await callbackQueryHandler.handle(callbackQuery);
});

telegram.on("polling_error", (error) => {
  console.error("[Telegram Polling Error]", error.code, error.message);
});

telegram.on("webhook_error", (error) => {
  console.error("[Telegram Webhook Error]", error.code, error.message);
});
