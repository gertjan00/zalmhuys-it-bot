const { Client } = require("@notionhq/client");

const notionApiKey = process.env.NOTION_API_KEY;

if (!notionApiKey) {
  console.error("FOUT: Notion API Key niet ingesteld in .env bestand!");
  process.exit(1);
}

const notion = new Client({ auth: notionApiKey });

console.log(" - Notion client geïnitialiseerd.");

module.exports = notion;
