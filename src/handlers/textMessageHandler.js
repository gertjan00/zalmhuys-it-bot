// src/handlers/textMessageHandler.js
const telegram = require("../lib/telegramClient");
const { saveChatMessage } = require("../lib/supabaseClient");
const { getLangchainResponse } = require("../lib/langchainClient");
const { BOT_ID } = require("../config");

async function handle(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userMessageId = msg.message_id;
  const userName = msg.from.first_name || msg.from.username;
  const userText = msg.text;

  console.log(
    `[TextMessageHandler - Chat ${chatId}] Van ${userName}: "${userText.substring(0, 50)}${
      userText.length > 50 ? "..." : ""
    }"`
  );

  try {
    await saveChatMessage(chatId, userId, userMessageId, "user", userText);
  } catch (e) {
    console.error(`[TextMessageHandler - Chat ${chatId}] Kon gebruikersbericht niet opslaan.`);
  }

  try {
    await telegram.sendChatAction(chatId, "typing");
  } catch (e) {}

  let botReplyText;
  try {
    botReplyText = await getLangchainResponse(chatId, userText);
  } catch (e) {
    console.error(`[TextMessageHandler - Chat ${chatId}] Fout bij getLangchainResponse.`);
    botReplyText = "Sorry, er ging iets mis bij het verwerken van uw vraag.";
  }

  let sentBotMessage;
  try {
    sentBotMessage = await telegram.sendMessage(chatId, botReplyText);
    console.log(
      `[TextMessageHandler - Chat ${chatId}] Naar ${userName}: "${botReplyText
        .trim()
        .substring(0, 50)}${botReplyText.length > 50 ? "..." : ""}"`
    );
  } catch (e) {
    console.error(
      `[TextMessageHandler - Chat ${chatId}] Fout bij sturen Langchain antwoord:`,
      e.message
    );
    return;
  }

  if (sentBotMessage && sentBotMessage.message_id) {
    const botMessageId = sentBotMessage.message_id;
    const botUserIdPlaceholder = 0;
    try {
      await saveChatMessage(chatId, BOT_ID, botMessageId, "assistant", botReplyText);
    } catch (e) {
      console.error(`[TextMessageHandler - Chat ${chatId}] Kon botbericht niet opslaan.`);
    }
  } else {
    console.warn(
      `[TextMessageHandler - Chat ${chatId}] Geen message_id ontvangen voor botbericht, opslaan overgeslagen.`
    );
  }
}

module.exports = {
  handle,
};
