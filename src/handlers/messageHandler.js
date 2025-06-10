// src/handlers/messageHandler.js
const telegram = require("../lib/telegramClient"); // Importeer telegram client
const { saveChatMessage, getChatMessages } = require("../lib/supabaseClient"); // getChatMessages voor later
const { getGeminiResponse } = require("../lib/geminiClient");

async function handleIncomingMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userMessageId = msg.message_id;
  const userName = msg.from.first_name || msg.from.username;
  const userText = msg.text;

  if (!userText) {
    try {
      await telegram.sendMessage(chatId, "Ik kan alleen tekstberichten verwerken.");
    } catch (e) {
      console.error(`[MessageHandler - Chat ${chatId}] Fout bij sturen 'alleen tekst':`, e.message);
    }
    return;
  }

  console.log(
    `[MessageHandler - Chat ${chatId}] Van ${userName}: "${userText.substring(0, 50)}${
      userText.length > 50 ? "..." : ""
    }"`
  );

  try {
    await saveChatMessage(chatId, userId, userMessageId, "user", userText, { userName });
  } catch (e) {
    console.error(
      `[MessageHandler - Chat ${chatId}] FOUT bij opslaan gebruikersbericht:`,
      e.message
    );
  }

  try {
    await telegram.sendChatAction(chatId, "typing");
  } catch (e) {}

  let geminiReplyText;
  try {
    geminiReplyText = await getGeminiResponse(null, chatHistoryForGemini);
  } catch (e) {
    console.error(`[MessageHandler - Chat ${chatId}] Fout bij getGeminiResponse:`, e.message);
    geminiReplyText = "Sorry, er ging iets mis bij het verwerken van  vraag.";
  }

  let sentBotMessage;
  try {
    sentBotMessage = await telegram.sendMessage(chatId, geminiReplyText);
    console.log(
      `[MessageHandler - Chat ${chatId}] Naar ${userName}: "${geminiReplyText
        .trim()
        .substring(0, 50)}${geminiReplyText.length > 50 ? "..." : ""}"`
    );
  } catch (e) {
    console.error(`[MessageHandler - Chat ${chatId}] Fout bij sturen Gemini antwoord:`, e.message);
    return;
  }

  if (sentBotMessage && sentBotMessage.message_id) {
    const botMessageId = sentBotMessage.message_id;
    const botUserIdPlaceholder = 0;
    try {
      await saveChatMessage(
        chatId,
        botUserIdPlaceholder,
        botMessageId,
        "assistant",
        geminiReplyText,
        { botName: "ZalmhuysITBot" }
      );
    } catch (e) {
      console.error(
        `[MessageHandler - Chat ${chatId}] EXCEPTION bij opslaan botbericht:`,
        e.message
      );
    }
  } else {
    console.warn(
      `[MessageHandler - Chat ${chatId}] Geen message_id ontvangen voor botbericht, opslaan overgeslagen.`
    );
  }
}

module.exports = {
  handleIncomingMessage,
};
