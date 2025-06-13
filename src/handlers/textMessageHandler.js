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
    console.error(
      `[TextMessageHandler - Chat ${chatId}] Kon gebruikersbericht niet opslaan: ${e.message}`
    );
  }

  try {
    await telegram.sendChatAction(chatId, "typing"); // Blijft nuttig als algemene indicator
  } catch (e) {
    /* ignore */
  }

  let botReplyText;
  try {
    botReplyText = await getLangchainResponse(chatId, userText);
  } catch (e) {
    // Fouten in getLangchainResponse zelf (niet per se LLM/tool errors die de LLM zou moeten afhandelen)
    console.error(
      `[TextMessageHandler - Chat ${chatId}] Kritieke fout bij getLangchainResponse:`,
      e.message,
      e.stack
    );
    botReplyText =
      "Sorry, er is een onverwachte technische storing opgetreden. Probeer het later opnieuw.";
  }

  // Alleen een bericht sturen als er daadwerkelijk tekstuele output is van de hoofd-LLM
  // De TelegramStatusUpdateHandler stuurt zijn eigen berichten voor tool-status etc.
  if (botReplyText && typeof botReplyText === "string" && botReplyText.trim() !== "") {
    let sentBotMessage;
    try {
      sentBotMessage = await telegram.sendMessage(chatId, botReplyText, { parse_mode: "Markdown" }); //Markdown kan handig zijn voor URLs
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
      // Als het sturen van het hoofdbericht mislukt, proberen we een fallback zonder Markdown
      try {
        sentBotMessage = await telegram.sendMessage(chatId, botReplyText);
        console.log(
          `[TextMessageHandler - Chat ${chatId}] Naar ${userName} (fallback zonder markdown): "${botReplyText
            .trim()
            .substring(0, 50)}${botReplyText.length > 50 ? "..." : ""}"`
        );
      } catch (e2) {
        console.error(
          `[TextMessageHandler - Chat ${chatId}] Fout bij sturen Langchain antwoord (ook fallback mislukt):`,
          e2.message
        );
        return; // Stop verdere verwerking voor dit bericht
      }
    }

    if (sentBotMessage && sentBotMessage.message_id) {
      const botMessageId = sentBotMessage.message_id;
      try {
        await saveChatMessage(chatId, BOT_ID, botMessageId, "assistant", botReplyText);
      } catch (e) {
        console.error(
          `[TextMessageHandler - Chat ${chatId}] Kon botbericht niet opslaan: ${e.message}`
        );
      }
    } else {
      console.warn(
        `[TextMessageHandler - Chat ${chatId}] Geen message_id ontvangen voor botbericht, opslaan overgeslagen.`
      );
    }
  } else {
    console.log(
      `[TextMessageHandler - Chat ${chatId}] Geen tekstueel antwoord van LLM om te sturen (botReplyText: '${botReplyText}'). Mogelijk alleen tool call(s) of lege respons. Eventuele statusupdates zijn via de callback handler verstuurd.`
    );
  }
}

module.exports = {
  handle,
};
