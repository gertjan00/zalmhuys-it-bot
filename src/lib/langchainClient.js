// src/lib/langchainClient.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const telegram = require("./telegramClient");

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const { AIMessage, HumanMessage, ToolMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, END, START } = require("@langchain/langgraph");
const { getChatMessages } = require("./supabaseClient");
const { tools, toolsDescription, toolNames } = require("./tools"); // toolsDescription en toolNames worden gebruikt in de prompt
const { TelegramStatusUpdateHandler } = require("./TelegramStatusUpdateHandler"); // NIEUW

const SYSTEM_INSTRUCTION_BASE = `Jij bent Zalmhuys IT Bot, een vriendelijke, proactieve en efficiënte AI-assistent voor medewerkers van Zalmhuys.
Je primaire doel is om collega's te helpen IT-problemen te verduidelijken, de benodigde context en details te verzamelen (inclusief antwoorden op troubleshooting-vragen) en, indien mogelijk, eenvoudige oplossingen aan te dragen. Als het probleem complexer is of specifieke actie vereist die jij niet kunt uitvoeren, maak je een gedetailleerd ticket aan met alle relevante verzamelde informatie, die als netjes geformatteerde hoofdinhoud (met alinea's) op de ticketpagina zal verschijnen. De naam van de melder is essentieel voor een ticket.
Gebruik natuurlijke taal. Stel vragen één voor één en wacht op antwoord. Houd je berichten beknopt maar zorg dat je alle nodige informatie verzamelt voor een compleet ticket. De supportmedewerker die het ticket oppakt, heeft ALLEEN de ticketinformatie en NIET deze chatgeschiedenis.

Je hebt toegang tot de volgende tools (de details en het gebruik ervan zijn jouw interne kennis):
{tools_description}

Algemene Gespreksstijl:
*   Natuurlijk en Gespreksgericht: Start met een open vraag zoals 'Waarmee kan ik je helpen?'. Verwijs naar de gebruiker met 'je' of 'jij'. Vermijd technische jargon over je interne processen.
*   Beknopt en Direct: Geen onnodige beleefdheden. Kom snel ter zake, maar sla geen cruciale diagnostische stappen over.
*   Eén Vraag per Keer (meestal): Stel vragen sequentieel om de gebruiker niet te overweldigen.
*   Meedenkend en Analytisch: Probeer de kern van het probleem te begrijpen. Leid relevante informatie af en vraag actief naar ontbrekende details die nodig zijn voor een goed begrip of een compleet ticket.

Teamleden voor Toewijzing (voor jouw interne logica - zorg dat deze namen EXACT overeenkomen met de Notion 'Select' opties voor 'Toegewezen aan', indien van toepassing):
*   Nicolas: IT expert. Complexe technische problemen, of als Evert er niet uitkomt.
*   Evert: IT expert. Printers, scanners, labels, hardware, overige simpele IT-zaken.
*   Gert Jan: Claever expert. Doorontwikkelingsvragen (projecten), hardnekkige Claever problemen.
*   Hendrik: Claever expert. Overige Claever problemen (niet projecten/doorontwikkeling, niet extreem hardnekkig).
*   Hessel: Leidinggevende. Grote, niet-toewijsbare problemen.
*   Indien niet duidelijk toewijsbaar aan bovenstaande of klein/algemeen: Laat 'Toegewezen aan' leeg.

Hoofd Werkwijze (Probleemoplossing & Ticket Creatie):
1.  Initiële Probleemmelding & Actief Luisteren: Wanneer een gebruiker een probleem meldt, luister aandachtig.
2.  Diepgaande Probleemanalyse & Informatieverzameling: Stel gerichte, verhelderende vragen om de volledige context van het probleem te achterhalen. Je doel is een zo compleet mogelijk beeld te krijgen voor het ticket. Verzamel informatie over:
    *   Applicatie/Systeem
    *   Exacte Probleem
    *   Foutmeldingen
    *   Reproductiestappen
    *   Timing
    *   Impact/Scope
    *   Standaard Troubleshooting Stappen
    Alle antwoorden op deze (troubleshooting) vragen zijn essentieel en moeten worden opgenomen in de uiteindelijke, gedetailleerde, GOED GEFORMATTEERDE (met witregels/alinea's) omschrijving van het ticket.
3.  Eenvoudige Suggesties (Zeer Beperkt): (Blijft hetzelfde)
4.  Inschatting & Voorstel Ticket: Nadat je intern hebt vastgesteld dat je voldoende informatie hebt verzameld om het probleem te begrijpen, stel je voor om een ticket aan te maken: 'Zal ik hiervoor een ticket aanmaken zodat een collega ernaar kan kijken?'.
5.  Bevestiging en Melder Informatie:
    A.  Als de gebruiker **bevestigt** (bijvoorbeeld met 'ja', 'graag', 'is goed'), is jouw **ALLEREERSTE VOLGENDE vraag ALTIJD**: 'Prima. Welke naam mag ik noteren als melder voor dit ticket?'.
    B.  Wacht op het antwoord van de gebruiker. Zodra de gebruiker een duidelijke naam (of 'anoniem/onbekend') opgeeft, ga je **ONMIDDELLIJK** verder met de tool calls zoals hieronder beschreven, zonder verdere conversatie of bevestiging.
6.  Ticket Creatie Proces (na verkrijgen naam melder):
    A.  Je EERSTE tool call is ALTIJD 'get_notion_database_schema'. Roep deze tool aan ZONDER ARGUMENTEN (of met args: {}). De statusupdate voor deze tool call wordt extern onderdrukt; je hoeft geen 'announce_status' te sturen of hier rekening mee te houden.
    B.  Nadat je de output van 'get_notion_database_schema' hebt ontvangen, analyseer je dit schema.
    C.  Ticket Details Voorbereiden:
        *   Toewijzing: Bepaal intern aan wie het ticket toegewezen moet worden.
        *   Op Agenda: Standaard false.
        *   Hoofd Omschrijving (voor Page Content): Formuleer een gedetailleerde omschrijving met alle verzamelde informatie, goed geformatteerd met dubbele backslash n (\\n) voor nieuwe alinea's. Begin met 'Melder: [Naam Melder].'.
        *   Notion 'Omschrijving' Property: Gebruik 'Zie pagina-inhoud voor de volledige probleemomschrijving.'
    D.  Roep dan de 'create_ticket_in_notion' tool aan.
        De input JSON string bevat de reguliere Notion properties en een aparte key, genaamd 'page_content_details', die de volledige, geformatteerde tekst bevat voor de page content.
        Voorbeeld JSON input string:
        {'Onderwerp':'Printen lukt niet (via USB)', 'page_content_details':'Melder: Jan Bekkien.\\n\\nProbleem: Printen vanuit Claever lukt niet. Alles lijkt goed te staan. Printen vanuit Word lukt wel. Claever herstarten heeft niet geholpen. Probleem sinds zojuist.\\n\\nDetails:\\n- Geen foutmelding.', 'Gemeld door':'Jan Bekkien', 'Toegewezen aan':'Evert', 'Prioriteit':'Normaal', 'Categorie':'Hardware', 'Op Agenda':false, 'announce_status':true}
        (BELANGRIJK: De tool code moet de waarde van 'page_content_details' gebruiken om de page content blocks te maken en mag NIET proberen 'page_content_details' als Notion property te zetten).

Speciale Instructie voor Testen (Alleen als de gebruiker expliciet om een 'test ticket' vraagt):
Als de gebruiker expliciet vraagt om een 'test ticket', sla dan de normale vraag om bevestiging ('Zal ik hiervoor een ticket aanmaken...') EN de vraag naar de melder volledig over. Ga direct over tot de tool calls.
1.  Jouw EERSTE AIMessage MOET ALLEEN een tool_call bevatten voor 'get_notion_database_schema'. Roep deze aan ZONDER ARGUMENTEN (of met args: {}). Geen tekst. De statusupdate voor deze tool wordt extern onderdrukt.
2.  Nadat je de schema output hebt, MOET je VOLGENDE AIMessage ALLEEN een tool_call bevatten voor 'create_ticket_in_notion'.
    De args voor de tool call moeten een object zijn met één key, 'input'. De waarde van 'input' is een JSON string.
    Deze JSON string moet, wanneer geparsed, een plat object zijn. Het binnenste platte object (na parsen van de string) ziet er bijvoorbeeld zo uit:
    {'announce_status': true, 'Onderwerp': 'Test Ticket van Bot', 'page_content_details':'Dit is een automatisch gegenereerd testticket op verzoek van de gebruiker.\\n\\nAlle systemen functioneren normaal.', 'Gemeld door': 'IT Bot Test', 'Toegewezen aan':'', 'Prioriteit': 'Laag', 'Categorie': 'Test', 'Op Agenda':false}
    Gebruik valide waarden.
3.  Nadat die tool is uitgevoerd, geef je in een AIMessage met ALLEEN content het resultaat (ticket URL of fout). Stel geen verdere vragen na deze tool call.

Tool Aanroep Details:
*   Voor 'get_notion_database_schema': Roep aan zonder argumenten (of met args: {}). De statusupdate wordt extern afgehandeld/onderdrukt.
*   Voor 'create_ticket_in_notion': De JSON input string bevat de key 'page_content_details' voor de volledige tekst voor page content. De tool code MOET 'page_content_details' gebruiken voor de page content en NIET als property proberen te verwerken. Zorg ervoor dat de 'Gemeld door' property gevuld wordt met de naam die de gebruiker heeft opgegeven. **Stuur GEEN 'Omschrijving' property meer mee in de JSON voor de tool, tenzij dit een andere, nog bestaande property is.**
...

**BELANGRIJKE REGEL VOOR HERHAALDE ACTIES:**
(Deze sectie kan hetzelfde blijven)
Wanneer een gebruiker vraagt om een actie te herhalen die tools vereist (zoals "maak nog een ticket", "doe dat nog eens", "nog eentje" in de context van een ticket), moet je ALTIJD de volledige tool-aanroepsequentie (e.g., 'get_notion_database_schema' gevolgd door 'create_ticket_in_notion') opnieuw starten, inclusief het opnieuw verzamelen van de benodigde informatie voor het *nieuwe* ticket (zoals de melder en een frisse probleemomschrijving).
Baseer je antwoord NOOIT op het resultaat van een *vorige* tool-uitvoering, zelfs als de vraag identiek lijkt. Elk verzoek om een *nieuw* item (zoals een ticket) te creëren, vereist een *nieuwe* en *volledige* uitvoering van de relevante tools. Genereer geen "oude" ticket URL's of resultaten.

Wanneer je een tool aanroept, krijg je de output (Observation) in de volgende stap. Baseer je antwoord aan de gebruiker ALLEEN op die daadwerkelijke observatie. Je hoeft de gebruiker NIET te informeren dat je 'bezig bent' met een tool; dat doet het systeem via aparte statusupdates. Jouw taak is de conversatie te leiden en correct tools aan te roepen.`;

const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.0-flash";
const CHAT_HISTORY_MESSAGE_LIMIT = 20;

if (!process.env.GEMINI_API_KEY) {
  console.error("FOUT: GEMINI_API_KEY niet ingesteld in .env bestand!");
  process.exit(1);
}

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: GEMINI_MODEL_NAME,
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ],
  temperature: 0.1,
});

const llmWithTools = llm.bindTools(tools);

const agentStateChannels = {
  input: {
    value: null,
    alwaysWrite: true,
  },
  chat_history: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
};

// --- NODES ---
async function callAgentLogic(state) {
  let currentMessages = [...state.chat_history];
  if (state.input) {
    const lastMessage =
      currentMessages.length > 0 ? currentMessages[currentMessages.length - 1] : null;
    if (!(lastMessage instanceof HumanMessage && lastMessage.content === state.input)) {
      currentMessages.push(new HumanMessage(state.input));
    }
  }

  const llmResponse = await llmWithTools.invoke(currentMessages);
  if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
    console.log(
      // Alleen loggen als er tool calls zijn
      `[LangGraph] LLM stelt tool call voor: ${llmResponse.tool_calls[0].name}${
        llmResponse.tool_calls.length > 1 ? ` (en ${llmResponse.tool_calls.length - 1} meer)` : ""
      }`
    );
  } else {
  }

  return {
    chat_history: [llmResponse],
    input: null,
  };
}

async function customToolExecutorNodeLogic(state, config) {
  const lastAiMessage = state.chat_history[state.chat_history.length - 1];
  const newToolMessages = [];
  const chatIdForTools = config?.configurable?.thread_id;

  if (
    !(lastAiMessage instanceof AIMessage) ||
    !lastAiMessage.tool_calls ||
    lastAiMessage.tool_calls.length === 0
  ) {
    console.warn(
      "[LangGraph] customToolExecutorNodeLogic: Laatste bericht is geen AIMessage met tool_calls, of geen tool_calls. State:",
      state.chat_history
    );
    return { chat_history: [] };
  }

  for (const toolCall of lastAiMessage.tool_calls) {
    const toolToExecute = tools.find((t) => t.name === toolCall.name);
    if (toolToExecute) {
      let observation;
      let rawLlmArgs = JSON.parse(JSON.stringify(toolCall.args || {}));
      let processedArgsForToolInvoke;

      try {
        if (toolToExecute.name === "get_notion_database_schema") {
          processedArgsForToolInvoke = {};
          if (chatIdForTools) {
            await telegram.sendChatAction(chatIdForTools, "typing");
            await telegram.sendMessage(chatIdForTools, "Ik haal even de ticketstructuur op...");
          }
        } else if (toolToExecute.name === "create_ticket_in_notion") {
          processedArgsForToolInvoke = rawLlmArgs;
          if (rawLlmArgs.input && typeof rawLlmArgs.input === "string" && chatIdForTools) {
            try {
              const parsedInputForStatus = JSON.parse(rawLlmArgs.input);
              if (parsedInputForStatus.announce_status === true) {
                await telegram.sendChatAction(chatIdForTools, "typing");
                await telegram.sendMessage(
                  chatIdForTools,
                  "Moment, ik ben het ticket nu aan het aanmaken in Notion..."
                );
              }
            } catch (e) {}
          }
        } else {
          processedArgsForToolInvoke = rawLlmArgs;
        }

        if (observation === undefined) {
          observation = await toolToExecute.invoke(processedArgsForToolInvoke);
        }
        newToolMessages.push(
          new ToolMessage({
            content: String(observation),
            tool_call_id: toolCall.id,
            name: toolCall.name,
          })
        );
      } catch (error) {
        console.error(`[LangGraph] FOUT bij tool ${toolCall.name}: ${error.message}`);
        observation = `FOUT_IN_TOOL: ${error.message}`;
        newToolMessages.push(
          new ToolMessage({
            content: String(observation),
            tool_call_id: toolCall.id,
            name: toolCall.name,
          })
        );
      }
    } else {
      console.warn(`[LangGraph] Tool niet gevonden: ${toolCall.name}`);
      newToolMessages.push(
        new ToolMessage({
          content: `Tool ${toolCall.name} niet gevonden.`,
          tool_call_id: toolCall.id,
          name: toolCall.name,
        })
      );
    }
  }
  return { chat_history: newToolMessages };
}
// --- EDGES / CONDITIONAL LOGIC ---
function shouldInvokeTool(state) {
  const lastMessage = state.chat_history[state.chat_history.length - 1];

  if (lastMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "invoke_tool";
  }
  return END;
}

// --- GRAPH ASSEMBLY ---
const workflow = new StateGraph({ channels: agentStateChannels });

workflow.addNode("agent", callAgentLogic);
workflow.addNode("tool_executor", customToolExecutorNodeLogic);

workflow.addEdge(START, "agent");

workflow.addConditionalEdges("agent", shouldInvokeTool, {
  invoke_tool: "tool_executor",
  [END]: END,
});
workflow.addEdge("tool_executor", "agent");

const compiledGraphApp = workflow.compile();

// --- MAIN FUNCTION ---
async function getLangchainResponse(chatId, userInput) {
  console.log(
    `[LangGraph - Chat ${chatId}] Input: "${userInput.substring(0, 30)}${
      userInput.length > 30 ? "..." : ""
    }"`
  );

  const statusUpdateHandler = new TelegramStatusUpdateHandler(chatId);

  try {
    const dbMessages = await getChatMessages(chatId, CHAT_HISTORY_MESSAGE_LIMIT);
    const initialChatHistory = dbMessages
      .map((msg) => {
        if (!msg) return null;
        if (msg.sender_role === "user") return new HumanMessage({ content: msg.content });
        if (msg.sender_role === "assistant" || msg.sender_role === "model") {
          return new AIMessage({ content: msg.content });
        }
        return null;
      })
      .filter(Boolean);

    const systemInstructionText = SYSTEM_INSTRUCTION_BASE.replace(
      "{tools_description}",
      toolsDescription
    ).replace("{tool_names}", toolNames);
    let runTimeChatHistory = [];
    const hasSystemMessage = initialChatHistory.some((m) => m instanceof SystemMessage);
    if (!hasSystemMessage) {
      runTimeChatHistory.push(new SystemMessage(systemInstructionText));
      runTimeChatHistory.push(...initialChatHistory.slice(-(CHAT_HISTORY_MESSAGE_LIMIT - 1)));
    } else {
      const nonSystemMessages = initialChatHistory.filter((m) => !(m instanceof SystemMessage));
      runTimeChatHistory.push(new SystemMessage(systemInstructionText));
      runTimeChatHistory.push(...nonSystemMessages.slice(-(CHAT_HISTORY_MESSAGE_LIMIT - 1)));
    }

    const finalState = await compiledGraphApp.invoke(
      { input: userInput, chat_history: [...runTimeChatHistory] },
      {
        recursionLimit: 15,
        configurable: {
          thread_id: String(chatId),
          callbacks: [statusUpdateHandler],
        },
      }
    );

    const lastAiMessage = finalState.chat_history.filter((m) => m instanceof AIMessage).pop();

    if (lastAiMessage) {
      let botResponseText = "";
      if (typeof lastAiMessage.content === "string") {
        botResponseText = lastAiMessage.content;
      } else if (Array.isArray(lastAiMessage.content)) {
        botResponseText = lastAiMessage.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
      }

      if (
        botResponseText.trim() === "" &&
        lastAiMessage.tool_calls &&
        lastAiMessage.tool_calls.length > 0
      ) {
        console.log(
          `[LangGraph - Chat ${chatId}] LLM gaf geen tekstuele content, alleen tool_calls. Statusupdates via handler.`
        );
        return "";
      }

      return botResponseText;
    } else {
      console.error(
        `[LangGraph - Chat ${chatId}] Geen AIMessage gevonden in finale state. State:`,
        finalState
      );
      return "Sorry, ik kon geen antwoord van de AI verwerken op dit moment.";
    }
  } catch (error) {
    console.error(
      `[LangGraph - Chat ${chatId}] Fout in getLangchainResponse: ${error.message}`,
      error.stack,
      error.cause
    );
    let userMessage = "Sorry, er ging iets mis bij het verwerken van uw vraag via de AI.";
    if (error.message) {
      if (error.message.toLowerCase().includes("safety")) {
        userMessage =
          "Sorry, ik kan geen antwoord genereren vanwege de veiligheidsinstellingen van de AI.";
      } else if (error.message.toLowerCase().includes("recursion")) {
        userMessage =
          "Sorry, het lijkt erop dat de AI in een lus terecht is gekomen. Kun je de vraag anders formuleren of het gesprek opnieuw starten?";
      } else if (
        error.message.toLowerCase().includes("quota") ||
        error.message.toLowerCase().includes("limit")
      ) {
        userMessage =
          "Het spijt me, er is momenteel een technisch probleem met de verbinding naar de AI (limiet bereikt). Probeer het later opnieuw.";
      }
    }
    return userMessage;
  }
}

console.log(` - Langchain client (LangGraph) geïnitialiseerd met model: ${GEMINI_MODEL_NAME}.`);

module.exports = {
  getLangchainResponse,
};
