// src/lib/tools.js
const { DynamicTool } = require("@langchain/core/tools");

const getTicketStatusTool = new DynamicTool({
  name: "get_ticket_status",
  // De beschrijving kan nu wat algemener zijn, of specifiek de { "input": "..." } structuur noemen.
  description:
    // Laten we de vorige beschrijving (Optie 1.A) even behouden, de LLM lijkt het goed op te pakken.
    "Gebruik deze tool om de status van een specifiek IT-ticket op te zoeken. De input voor deze tool is direct het ticket ID als een string, bijvoorbeeld 'T-123'.",
  // Zelfs met bovenstaande description, lijkt Gemini met bindTools de neiging te hebben om {"input": "..."} te sturen.
  // Laten we de func aanpassen om robuuster te zijn.

  func: async (toolArgs) => {
    // Accepteer het object dat de LLM stuurt
    let ticketId;
    if (typeof toolArgs === "string") {
      // Als de LLM (of ToolNode) het toch als platte string doorgeeft
      ticketId = toolArgs;
    } else if (toolArgs && typeof toolArgs.input === "string") {
      // Als de LLM het als { input: "..." } object stuurt
      ticketId = toolArgs.input;
    } else {
      console.error("[Tool] get_ticket_status: Onverwachte argument structuur:", toolArgs);
      return "Ticket ID niet correct meegegeven aan get_ticket_status tool. Verwachte { input: 'ticketID' } of directe string.";
    }

    console.log(`[Tool] get_ticket_status aangeroepen met ID: ${ticketId}`);

    if (typeof ticketId !== "string" || !ticketId) {
      return `Ongeldig Ticket ID ontvangen: ${ticketId}`;
    }

    if (ticketId.toLowerCase() === "t-123") {
      return "Status voor T-123: In behandeling door Netwerkbeheer.";
    }
    return `Ticket met ID ${ticketId} is niet gevonden.`;
  },
});

const getCurrentTimeTool = new DynamicTool({
  name: "get_current_time",
  description: "Gebruik deze tool om de huidige datum en tijd op te vragen.",
  func: async () => {
    console.log(`[Tool] get_current_time aangeroepen.`);
    return new Date().toLocaleString("nl-NL");
  },
});

const tools = [getTicketStatusTool, getCurrentTimeTool];

// Genereer de teksten die de agent nodig heeft.
const toolsDescription = tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n");
const toolNames = tools.map((tool) => tool.name).join(", ");

module.exports = {
  tools,
  toolsDescription,
  toolNames,
};
