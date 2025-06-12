// src/handlers/textMessageHandler.js
const telegram = require("../lib/telegramClient");
const { saveChatMessage } = require("../lib/supabaseClient");
const { streamLangchainResponse } = require("../lib/langchainClient"); // Aangepast
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
  } catch (e) {
    /* ignore */
  }

  let lastBotReplyText = null;
  let lastSentBotMessage = null;

  try {
    for await (const messagePart of streamLangchainResponse(chatId, userText)) {
      if (messagePart.type === "bot_response" || messagePart.type === "error") {
        const botReplyText = messagePart.content;
        if (botReplyText && botReplyText.trim() !== "") {
          try {
            const sentMessage = await telegram.sendMessage(chatId, botReplyText);
            console.log(
              `[TextMessageHandler - Chat ${chatId}] Naar ${userName} (streamed): "${botReplyText
                .trim()
                .substring(0, 50)}${botReplyText.length > 50 ? "..." : ""}"`
            );
            // Onthoud het laatst gestuurde bericht en zijn inhoud voor opslag
            lastBotReplyText = botReplyText;
            lastSentBotMessage = sentMessage;
          } catch (e) {
            console.error(
              `[TextMessageHandler - Chat ${chatId}] Fout bij sturen Langchain deelantwoord:`,
              e.message
            );
            // Als een deel mislukt, loggen we en de stream stopt mogelijk of levert een error.
            // Het is belangrijk dat de error-handling in streamLangchainResponse robuust is.
          }
        }
      }
    }
  } catch (e) {
    // Deze catch is voor als de async iterator zelf een onverwachte error gooit.
    console.error(
      `[TextMessageHandler - Chat ${chatId}] Fout bij itereren streamLangchainResponse:`,
      e.message
    );
    try {
      const fallbackMessage =
        "Sorry, er ging een onverwachte fout op tijdens het verwerken van je vraag.";
      lastSentBotMessage = await telegram.sendMessage(chatId, fallbackMessage);
      lastBotReplyText = fallbackMessage;
    } catch (sendError) {
      console.error(
        `[TextMessageHandler - Chat ${chatId}] Fout bij sturen fallback error bericht:`,
        sendError.message
      );
    }
  }

  // Sla alleen het ALLERLAATSTE succesvol gestuurde botbericht op
  if (lastSentBotMessage && lastSentBotMessage.message_id && lastBotReplyText) {
    try {
      await saveChatMessage(
        chatId,
        BOT_ID,
        lastSentBotMessage.message_id,
        "assistant",
        lastBotReplyText
      );
      console.log(
        `[TextMessageHandler - Chat ${chatId}] Laatste botbericht opgeslagen (ID: ${lastSentBotMessage.message_id}).`
      );
    } catch (e) {
      console.error(`[TextMessageHandler - Chat ${chatId}] Kon laatste botbericht niet opslaan.`);
    }
  } else if (lastBotReplyText && !lastSentBotMessage) {
    console.warn(
      `[TextMessageHandler - Chat ${chatId}] Wel een laatste bot reply tekst, maar geen message_id (versturen mogelijk mislukt). Opslaan overgeslagen.`
    );
  } else {
    // Geen bericht verstuurd, of het laatste was een error die niet opgeslagen hoeft te worden als 'assistant' bericht.
    console.log(
      `[TextMessageHandler - Chat ${chatId}] Geen definitief botbericht om op te slaan na stream, of laatste bericht was een error.`
    );
  }
}

module.exports = {
  handle,
};
