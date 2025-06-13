const { Client } = require("@notionhq/client");

const notionApiKey = process.env.NOTION_API_KEY;

if (!notionApiKey) {
  console.error("FOUT: Notion API Key niet ingesteld in .env bestand!");
  process.exit(1);
}

const notion = new Client({ auth: notionApiKey });
console.log(" - Notion client geïnitialiseerd.");

async function getDatabaseSchema(databaseId) {
  try {
    const response = await notion.databases.retrieve({ database_id: databaseId });
    return response.properties;
  } catch (error) {
    console.error(`[NotionClient] Fout bij ophalen DB schema ${databaseId}: ${error.message}`);
    return `Kon schema niet ophalen voor database ${databaseId}: ${error.message}`;
  }
}

async function createNotionPage(
  databaseId,
  pagePropertiesFromLlm,
  rawDbSchema,
  pageContentText = ""
) {
  try {
    const notionApiProperties = {};

    for (const propNameKey in pagePropertiesFromLlm) {
      const propValue = pagePropertiesFromLlm[propNameKey];
      const propDefinition = rawDbSchema[propNameKey];

      if (!propDefinition) {
        console.warn(`[NotionClient] Property '${propNameKey}' niet in schema. Overgeslagen.`);
        continue;
      }

      const readOnlyTypes = [
        "formula",
        "rollup",
        "created_time",
        "created_by",
        "last_edited_time",
        "last_edited_by",
        "unique_id",
        "files",
      ];
      if (readOnlyTypes.includes(propDefinition.type)) {
        continue;
      }

      switch (propDefinition.type) {
        case "title":
          notionApiProperties[propNameKey] = { title: [{ text: { content: String(propValue) } }] };
          break;
        case "rich_text":
          notionApiProperties[propNameKey] = {
            rich_text: [{ text: { content: String(propValue) } }],
          };
          break;
        case "select":
          if (propDefinition.select.options.some((opt) => opt.name === String(propValue))) {
            notionApiProperties[propNameKey] = { select: { name: String(propValue) } };
          } else {
            console.warn(
              `[NotionClient] Ongeldige optie '${propValue}' voor select '${propNameKey}'.`
            );
          }
          break;
        case "status":
          if (propDefinition.status.options.some((opt) => opt.name === String(propValue))) {
            notionApiProperties[propNameKey] = { status: { name: String(propValue) } };
          } else {
            console.warn(
              `[NotionClient] Ongeldige optie '${propValue}' voor status '${propNameKey}'.`
            );
          }
          break;
        case "multi_select":
          if (Array.isArray(propValue)) {
            const validOptions = propValue
              .map((val) => String(val))
              .filter((valStr) =>
                propDefinition.multi_select.options.some((opt) => opt.name === valStr)
              );
            if (validOptions.length > 0) {
              notionApiProperties[propNameKey] = {
                multi_select: validOptions.map((optName) => ({ name: optName })),
              };
            }
          } else {
            console.warn(
              `[NotionClient] Waarde voor multi_select '${propNameKey}' moet array zijn.`
            );
          }
          break;
        case "number":
          const num = parseFloat(propValue);
          if (!isNaN(num)) {
            notionApiProperties[propNameKey] = { number: num };
          } else {
            console.warn(
              `[NotionClient] Ongeldige waarde '${propValue}' voor number '${propNameKey}'.`
            );
          }
          break;
        case "checkbox":
          notionApiProperties[propNameKey] = { checkbox: Boolean(propValue) };
          break;
        case "date":
          if (typeof propValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(propValue)) {
            notionApiProperties[propNameKey] = { date: { start: propValue } };
          } else if (typeof propValue === "object" && propValue.start) {
            notionApiProperties[propNameKey] = { date: propValue };
          } else {
            console.warn(
              `[NotionClient] Ongeldig formaat '${propValue}' voor date '${propNameKey}'.`
            );
          }
          break;
        case "url":
          notionApiProperties[propNameKey] = { url: String(propValue) };
          break;
        case "email":
          notionApiProperties[propNameKey] = { email: String(propValue) };
          break;
        case "phone_number":
          notionApiProperties[propNameKey] = { phone_number: String(propValue) };
          break;
        default:
          // Voor onbekende types, geen actie, geen error, gewoon negeren.
          break;
      }
    }

    const pageContentBlocks = [];

    const textForPageBlocks = pageContentText; // Gebruik de parameter die nu de juiste data zou moeten bevatten

    if (
      textForPageBlocks &&
      typeof textForPageBlocks === "string" &&
      textForPageBlocks.trim() !== ""
    ) {
      const paragraphs = textForPageBlocks.split("\\n").filter((p) => p.trim() !== ""); // Gebruik textForPageBlocks
      paragraphs.forEach((paragraphText) => {
        pageContentBlocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: paragraphText,
                },
              },
            ],
          },
        });
      });
    }

    const titlePropName = Object.keys(rawDbSchema).find((key) => rawDbSchema[key].type === "title");
    if (!titlePropName || !notionApiProperties[titlePropName]) {
      const errorMsg = `Fout: Titel property ('${
        titlePropName || "Onbekend"
      }') is verplicht en ontbreekt of kon niet worden geformatteerd. Beschikbare properties in notionApiProperties: ${Object.keys(
        notionApiProperties
      ).join(", ")}`;
      console.error("[NotionClient.createNotionPage]", errorMsg);
      return errorMsg;
    }
    if (Object.keys(notionApiProperties).length === 0) {
      const errorMsg = "Fout: Geen geldige properties gevonden om in te stellen voor het ticket.";
      console.error("[NotionClient.createNotionPage]", errorMsg);
      return errorMsg;
    }

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: notionApiProperties,
      children: pageContentBlocks,
    });

    return response; // Retourneer het volledige response object bij succes
  } catch (error) {
    console.error(
      `[NotionClient.createNotionPage] Fout bij aanmaken Notion pagina: ${error.message}`,
      error.body ? JSON.parse(error.body) : "",
      error.stack // Log de stacktrace van de Notion client error
    );
    let notionErrorMsg = error.message;
    if (error.body) {
      try {
        const pBody = JSON.parse(error.body);
        if (pBody && pBody.message) notionErrorMsg = pBody.message;
      } catch (e) {
        /*ignore json parse error of body*/
      }
    }
    return `NOTION_API_ERROR: ${notionErrorMsg}`; // Duidelijke prefix
  }
}

module.exports = {
  getDatabaseSchema,
  createNotionPage,
};
