// src/lib/tools.js
const { DynamicTool } = require("@langchain/core/tools");
const notionClient = require("./notionClient");
const { NOTION_DATABASE_ID } = require("../config");

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

const getNotionDatabaseSchemaTool = new DynamicTool({
  name: "get_notion_database_schema",
  description: `Haalt de structuur (velden, types, opties) van de Zalmhuys IT Tickets Notion database (ID: ${NOTION_DATABASE_ID}) op. De output is een JSON object met alle property definities. Gebruik dit om te weten welke informatie nodig is en hoe de keys voor 'create_ticket_in_notion' te noemen (exacte property naam uit Notion). Identificeer read-only types om daar geen input voor te vragen. De 'title' property is altijd verplicht.`,
  func: async (_toolArgs) => {
    const schemaProperties = await notionClient.getDatabaseSchema(NOTION_DATABASE_ID);
    if (typeof schemaProperties === "string") return `Fout bij ophalen schema: ${schemaProperties}`;
    return JSON.stringify(schemaProperties, null, 2);
  },
});

const createTicketInNotionTool = new DynamicTool({
  name: "create_ticket_in_notion",
  description: `Maakt een nieuw IT-ticket aan in de Zalmhuys IT Tickets Notion database (ID: ${NOTION_DATABASE_ID}). Input: JSON object met property namen (uit het schema) als keys en gebruikerswaarden. 'title' property is verplicht. Bijv: { "Onderwerp": "...", "Status": "Nieuw" }. Geeft URL van ticket of foutmelding.`,
  func: async (toolArgs) => {
    let pagePropertiesFromLlm;

    // Loggen wat we precies ontvangen
    // console.log("[Tool] create_ticket_in_notion - Ontvangen toolArgs:", JSON.stringify(toolArgs));

    if (typeof toolArgs === "string") {
      // Direct een JSON string ontvangen (minder waarschijnlijk van LangGraph, maar voor robuustheid)
      try {
        pagePropertiesFromLlm = JSON.parse(toolArgs);
      } catch (e) {
        console.error(
          "[Tool] create_ticket_in_notion: Kon directe string toolArgs niet parsen:",
          toolArgs,
          e
        );
        return "Ongeldige input: directe string was geen valide JSON.";
      }
    } else if (toolArgs && typeof toolArgs === "object" && toolArgs !== null) {
      if (typeof toolArgs.input === "string") {
        // Meest voorkomende geval: {"input": "stringified_json"}
        try {
          pagePropertiesFromLlm = JSON.parse(toolArgs.input);
        } catch (e) {
          console.error(
            "[Tool] create_ticket_in_notion: Kon toolArgs.input string niet parsen:",
            toolArgs.input,
            e
          );
          return "Ongeldige input: 'input' string was geen valide JSON.";
        }
      } else if (typeof toolArgs.input === "object" && toolArgs.input !== null) {
        // Geval: {"input": {object_hier}}
        pagePropertiesFromLlm = toolArgs.input;
      } else if (Object.keys(toolArgs).length > 0 && !toolArgs.hasOwnProperty("input")) {
        // Geval: {direct_object_hier}, zonder 'input' wrapper
        pagePropertiesFromLlm = toolArgs;
      } else {
        console.warn(
          "[Tool] create_ticket_in_notion: Onverwachte structuur van toolArgs:",
          JSON.stringify(toolArgs)
        );
        return "Ongeldige inputstructuur voor create_ticket_in_notion.";
      }
    } else {
      console.warn("[Tool] create_ticket_in_notion: toolArgs is geen object of string:", toolArgs);
      return "Ongeldige input: toolArgs is geen object of string.";
    }

    if (
      !pagePropertiesFromLlm ||
      typeof pagePropertiesFromLlm !== "object" ||
      Object.keys(pagePropertiesFromLlm).length === 0
    ) {
      console.warn(
        "[Tool] create_ticket_in_notion: Geen geldige properties na parsen:",
        JSON.stringify(pagePropertiesFromLlm)
      );
      return "Geen geldige ticket properties ontvangen na het parsen van de input.";
    }

    // console.log("[Tool] create_ticket_in_notion - Te gebruiken properties:", JSON.stringify(pagePropertiesFromLlm));

    const rawDbSchema = await notionClient.getDatabaseSchema(NOTION_DATABASE_ID);
    if (typeof rawDbSchema === "string") {
      return `Kon ticket niet aanmaken: schemafout: ${rawDbSchema}`;
    }

    const result = await notionClient.createNotionPage(
      NOTION_DATABASE_ID,
      pagePropertiesFromLlm,
      rawDbSchema
    );

    if (typeof result === "string") return result;
    if (result && result.id && result.url) return `Ticket aangemaakt: ${result.url}`;
    if (result && result.id)
      return `Ticket aangemaakt met ID: ${result.id} (URL niet direct beschikbaar).`;
    return "Ticket mogelijk aangemaakt, maar onbekend resultaat.";
  },
});

const tools = [
  getTicketStatusTool,
  getCurrentTimeTool,
  getNotionDatabaseSchemaTool,
  createTicketInNotionTool,
];

// Genereer de teksten die de agent nodig heeft.
const toolsDescription = tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n\n");
const toolNames = tools.map((tool) => tool.name).join(", ");

module.exports = {
  tools,
  toolsDescription,
  toolNames,
};
