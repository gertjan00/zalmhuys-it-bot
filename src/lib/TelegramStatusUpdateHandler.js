// src/lib/TelegramStatusUpdateHandler.js
const { BaseCallbackHandler } = require("@langchain/core/callbacks/base");
const telegram = require("./telegramClient"); // Zorg ervoor dat dit de actieve telegram client instance is

class TelegramStatusUpdateHandler extends BaseCallbackHandler {
  name = "TelegramStatusUpdateHandler";
  chatId;

  constructor(chatId) {
    super();
    this.chatId = chatId;
    if (this.chatId) {
      console.log(`[TelegramStatusUpdateHandler] Geïnitialiseerd voor chatId: ${this.chatId}`);
    } else {
      console.warn(
        `[TelegramStatusUpdateHandler] Geïnitialiseerd ZONDER chatId. Statusupdates worden niet verstuurd.`
      );
    }
  }

  async handleToolStart(tool, input, runId, parentRunId, tags, metadata, name) {
    console.log(
      `[TelegramStatusUpdateHandler - Chat ${this.chatId}] Statusupdate (tool start: ${toolNameForLogic}): "${statusMessage}"`
    );

    if (!this.chatId) {
      console.log("[DEBUG - TelegramStatusUpdateHandler] Geen chatId, return.");
      return;
    }

    // 'tool' is het tool object, 'name' is de naam van de aangeroepen tool zoals gespecificeerd in de tool_call
    // 'metadata.name' kan ook de toolnaam bevatten, afhankelijk van hoe LangGraph het doorgeeft.
    const toolNameForLogic = name || (tool && tool.name) || (metadata && metadata.name);

    if (toolNameForLogic) {
      let statusMessage = `Ik start nu met: ${toolNameForLogic.replace(/_/g, " ")}...`;

      if (toolNameForLogic === "create_ticket_in_notion") {
        statusMessage = "Moment, ik ben het ticket nu aan het aanmaken in Notion...";
      } else if (toolNameForLogic === "get_notion_database_schema") {
        statusMessage = "Ik haal even de ticketstructuur op om een ticket te kunnen maken...";
      }
      // Voeg hier meer specifieke berichten toe voor andere tools indien nodig

      try {
        // Stuur eerst een "typing" actie voor een betere UX
        await telegram.sendChatAction(this.chatId, "typing");
        await telegram.sendMessage(this.chatId, statusMessage);
        console.log(
          `[TelegramStatusUpdateHandler - Chat ${this.chatId}] Statusupdate (tool start: ${toolNameForLogic}): "${statusMessage}"`
        );
      } catch (e) {
        console.error(
          `[TelegramStatusUpdateHandler - Chat ${this.chatId}] Fout bij sturen statusupdate voor tool ${toolNameForLogic}:`,
          e.message
        );
      }
    } else {
      console.warn(
        `[TelegramStatusUpdateHandler - Chat ${this.chatId}] handleToolStart aangeroepen, maar kon toolnaam niet bepalen. Tool:`,
        tool,
        "Name:",
        name,
        "Metadata:",
        metadata
      );
    }
  }

  async handleToolError(error, runId, parentRunId, tags, name) {
    if (!this.chatId) return;
    const toolNameForLogic = name; // 'name' bevat hier de naam van de tool die de error gaf

    if (toolNameForLogic) {
      const userFriendlyError = `Oeps, er ging iets mis tijdens het uitvoeren van '${toolNameForLogic.replace(
        /_/g,
        " "
      )}'. De technische fout is: ${error.message}`;
      try {
        await telegram.sendMessage(this.chatId, userFriendlyError);
        console.warn(
          `[TelegramStatusUpdateHandler - Chat ${this.chatId}] Foutstatus gestuurd voor tool ${toolNameForLogic}: "${userFriendlyError}"`
        );
      } catch (e) {
        console.error(
          `[TelegramStatusUpdateHandler - Chat ${this.chatId}] Fout bij sturen foutstatus (tool error) voor ${toolNameForLogic}:`,
          e.message
        );
      }
    }
  }

  // Je kunt hier meer handlers toevoegen als dat nodig is (bv. on_llm_start, on_chain_start),
  // maar wees voorzichtig om de gebruiker niet te spammen.
  // Voorbeeld:
  // async handleLLMStart(llm, prompts, runId, parentRunId, extraParams, tags, metadata) {
  //   if (!this.chatId) return;
  //   // Stuur alleen als het een "dure" LLM call is, of de eerste in een keten.
  //   // const llmName = metadata?.name || llm?.name || 'een AI model';
  //   // if (llmName === "ChatGoogleGenerativeAI") { // Check op de specifieke LLM
  //   //   try {
  //   //     await telegram.sendChatAction(this.chatId, "typing");
  //   //     // await telegram.sendMessage(this.chatId, `Ik ben je vraag aan het verwerken met ${llmName}...`);
  //   //   } catch (e) { /* ignore */ }
  //   // }
  // }
}

module.exports = { TelegramStatusUpdateHandler };
