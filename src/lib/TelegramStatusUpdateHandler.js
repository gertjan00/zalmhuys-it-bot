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

    const toolNameForLogic = name || (tool && tool.name) || (metadata && metadata.name);

    if (toolNameForLogic) {
      let statusMessage = `Ik start nu met: ${toolNameForLogic.replace(/_/g, " ")}...`;

      if (toolNameForLogic === "create_ticket_in_notion") {
        statusMessage = "Moment, ik ben het ticket nu aan het aanmaken in Notion...";
      } else if (toolNameForLogic === "get_notion_database_schema") {
        statusMessage = "Ik haal even de ticketstructuur op om een ticket te kunnen maken...";
      }

      try {
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
    const toolNameForLogic = name;

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
}

module.exports = { TelegramStatusUpdateHandler };
