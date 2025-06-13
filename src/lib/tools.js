// src/lib/tools.js
const { DynamicTool } = require("@langchain/core/tools");
const notionClient = require("./notionClient");
const { NOTION_DATABASE_ID } = require("../config");
const { z } = require("zod");

// getNotionDatabaseSchemaTool (blijft ongewijzigd, werkt correct)
const getNotionDatabaseSchemaTool = new DynamicTool({
  name: "get_notion_database_schema",
  description:
    "Haalt schema op. LLM hoeft geen argumenten mee te sturen voor deze tool. Statusupdates worden extern afgehandeld.",
  func: async (toolArgs) => {
    const schemaProperties = await notionClient.getDatabaseSchema(NOTION_DATABASE_ID);
    if (typeof schemaProperties === "string") {
      console.error(
        `[Tool:get_notion_database_schema] Fout van notionClient.getDatabaseSchema: ${schemaProperties}`
      );
      return `Fout bij ophalen schema: ${schemaProperties}`;
    }
    return JSON.stringify(schemaProperties);
  },
});

const createTicketInNotionTool = new DynamicTool({
  name: "create_ticket_in_notion",
  description: `Maakt een nieuw IT-ticket aan. Verwacht een 'input' argument dat een JSON string is van een plat object met ticket properties (bv. "Onderwerp", "Omschrijving") en optioneel 'announce_status: true'. Statusbericht wordt extern afgehandeld.`,
  argsSchema: z.object({
    // Dit schema dicteert dat invoke() een object {input: "string"} verwacht
    input: z
      .string()
      .describe(
        "Een JSON string die een plat object bevat met ticket properties en optioneel announce_status."
      ),
  }),
  // MAAR de func ontvangt dan direct de WAARDE van 'input'
  func: async (jsonInputString) => {
    let parsedInputObject;
    try {
      // De check verandert: jsonInputString moet nu zelf de string zijn.
      if (typeof jsonInputString !== "string" || jsonInputString.trim() === "") {
        console.error(
          "[Tool:create_ticket_in_notion] Ontvangen jsonInputString is geen string of is leeg."
        );
        return "FOUT_TOOL_INPUT_STRUCTUUR: De tool func verwachtte een JSON string, maar ontving iets anders of een lege string.";
      }
      parsedInputObject = JSON.parse(jsonInputString);
    } catch (e) {
      console.error(
        `[Tool:create_ticket_in_notion] Fout bij parsen JSON string: ${e.message}. Input string was: "${jsonInputString}"`
      );
      return `FOUT_TOOL_INPUT_PARSING: Kon JSON input string niet parsen. Detail: ${e.message}`;
    }

    // De rest van de logica blijft grotendeels hetzelfde, werkend met parsedInputObject
    const { announce_status, ...ticketProperties } = parsedInputObject || {};

    if (
      typeof ticketProperties !== "object" ||
      ticketProperties === null ||
      Object.keys(ticketProperties).length === 0
    ) {
      return "FOUT_TOOL_INPUT_DATA: Geen of ongeldige ticket properties na parsen en extractie.";
    }
    if (!ticketProperties.Onderwerp) {
      console.error(
        "[Tool:create_ticket_in_notion] 'Onderwerp' ontbreekt in ticketProperties:",
        JSON.stringify(ticketProperties)
      );
      return "FOUT_TOOL_INPUT_DATA: 'Onderwerp' is verplicht voor het aanmaken van een ticket.";
    }

    try {
      const rawDbSchema = await notionClient.getDatabaseSchema(NOTION_DATABASE_ID);
      if (typeof rawDbSchema === "string") {
        console.error("[Tool:create_ticket_in_notion] Fout bij ophalen DB schema:", rawDbSchema);
        return `NOTION_SCHEMA_ERROR: ${rawDbSchema}`;
      }

      const result = await notionClient.createNotionPage(
        NOTION_DATABASE_ID,
        ticketProperties,
        rawDbSchema
      );

      if (typeof result === "string") return `NOTION_CREATE_ERROR: ${result}`;
      if (result && result.object === "error") {
        console.error(
          "[Tool:create_ticket_in_notion] Notion API Error Object:",
          JSON.stringify(result, null, 2)
        );
        return `NOTION_API_ERROR: ${result.message || "Onbekende Notion API fout"}`;
      }
      if (result && result.id && result.url) return `Ticket aangemaakt: ${result.url}`;
      if (result && result.id)
        return `Ticket aangemaakt met ID: ${result.id} (URL niet direct beschikbaar).`;
      return "TICKET_CREATE_UNKNOWN_SUCCESS: Ticket mogelijk aangemaakt, maar onbekend resultaat.";
    } catch (e) {
      console.error(
        "[Tool:create_ticket_in_notion] Exception tijdens aanroepen notionClient of andere interne fout:",
        e.message,
        e.stack
      );
      return `TOOL_EXCEPTION: ${e.message}`;
    }
  },
});

const tools = [getNotionDatabaseSchemaTool, createTicketInNotionTool];

const toolsDescription = tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n\n");
const toolNames = tools.map((tool) => tool.name).join(", ");

module.exports = {
  tools,
  toolsDescription,
  toolNames,
};
