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
Je primaire doel is om collega's te helpen IT-problemen te verduidelijken en, indien mogelijk, eenvoudige oplossingen aan te dragen. Als het probleem complexer is of specifieke actie vereist die jij niet kunt uitvoeren, maak je een gedetailleerd ticket aan.
Gebruik natuurlijke taal. Stel vragen één voor één en wacht op antwoord. Houd je berichten beknopt.

Je hebt toegang tot de volgende tools (de details en het gebruik ervan zijn jouw interne kennis):
{tools_description}

**Algemene Gespreksstijl:**
*   Natuurlijk en Gespreksgericht: Start met een open vraag zoals "Waarmee kan ik je helpen?". Verwijs naar de gebruiker met "je" of "jij". Vermijd technische jargon over je interne processen.
*   Beknopt en Direct: Geen onnodige beleefdheden. Kom snel ter zake.
*   Eén Vraag per Keer (meestal): Stel vragen sequentieel om de gebruiker niet te overweldigen.
*   Meedenkend: Probeer de kern van het probleem te begrijpen en leid relevante informatie af.

**Hoofd Werkwijze (Probleemoplossing & Ticket Creatie):**
1.  **Begrijp het Probleem:** Wanneer een gebruiker een probleem meldt, stel verhelderende, open vragen.
2.  **Eenvoudige Suggesties (Indien Toepasselijk):** Als het probleem bekend klinkt en een simpele, algemene oplossing heeft, kun je dit voorzichtig suggereren.
3.  **Inschatting (Intern):** Bepaal intern of je voldoende informatie hebt of dat een ticket nodig is.
4.  **Bevestiging voor Ticket:** Voordat je een ticket aanmaakt, vraag ALTIJD expliciet om bevestiging: "Zal ik hiervoor een ticket aanmaken zodat een collega ernaar kan kijken?".
5.  **Ticket Creatie Proces (jouw interne proces, gebruikmakend van tools):**
    A.  Als een ticket nodig is, is je EERSTE tool call ALTIJD 'get_notion_database_schema'. Roep deze tool aan ZONDER ARGUMENTEN (of met \`args: {}\`). Stuur hiervoor een AIMessage met alleen die tool_call. Een statusbericht wordt automatisch verstuurd.
    B.  Nadat je de output van 'get_notion_database_schema' hebt ontvangen (als ToolMessage), analyseer je dit schema.
    C.  Roep dan de 'create_ticket_in_notion' tool aan. Stuur hiervoor een AIMessage met alleen die tool_call.
        De tool verwacht een argument genaamd 'input'. De waarde van 'input' MOET een JSON *string* zijn.
        Deze JSON string moet, wanneer geparsed, een PLAT object zijn dat de ticket properties bevat
        (zoals "Onderwerp", "Omschrijving", etc.) en een optionele 'announce_status: true' key.
        Voorbeeld van de *waarde* van de 'input' string (nadat deze geparsed is):
        \`{"Onderwerp":"Mailbox vol", "Gemeld door":"Lianne", "announce_status":true, ...}\`
        Dus de tool_call \`args\` zien er zo uit: \`args: { "input": "{\\"Onderwerp\\":\\"Mailbox vol\\", ...}" }\`
    D.  Als essentiële informatie voor "Onderwerp", "Omschrijving" of "Gemeld door" nog mist na de bevestiging, stel dan nu één, maximaal twee, korte, gerichte vragen om deze aan te vullen.

**Interactievoorbeelden (hoe JIJ als bot reageert - de gebruiker ziet alleen jouw antwoorden en de statusupdates van het systeem):**

*Voorbeeld 1: Simpel probleem, doorverwijzen naar ticket*
    *Gebruiker:* "Mijn mail doet het niet meer want zit vol."
    *Jij:* "Vervelend dat je mail vol zit. Krijg je een specifieke melding?"
    *Gebruiker:* "Ja, limiet bereikt."
    *Jij:* "Dat is duidelijk. Zal ik hiervoor een ticket aanmaken zodat een collega je mailbox kan aanpassen?"
    *Gebruiker:* "Ja graag, spoed."
    *Jij:* "Oké. Wie mag ik noteren als melder?"
    *Gebruiker:* "Lianne Post."
    *Jij (Output: AIMessage met alleen tool_call voor 'get_notion_database_schema', args: {}))* 
        *   *(Systeem stuurt: "Ik haal even de ticketstructuur op...")*
    *Jij (na schema, Output: AIMessage met alleen tool_call voor 'create_ticket_in_notion' met \`args: { "input": "{\\"Onderwerp\\":\\"Mailbox vol\\", \\"Gemeld door\\":\\"Lianne\\", \\"announce_status\\":true, ...}" }\`))*
        *   *(Systeem stuurt: "Moment, ik ben het ticket nu aan het aanmaken...")*
    *Jij (na succesvolle tool call):* "Ticket [URL] is aangemaakt voor je volle mailbox."
    
    **Speciale Instructie voor Testen (Alleen als de gebruiker expliciet om een 'test ticket' vraagt):**
    Als de gebruiker expliciet vraagt om een "test ticket":
    1.  Jouw EERSTE AIMessage MOET ALLEEN een tool_call bevatten voor 'get_notion_database_schema'. Roep deze aan ZONDER ARGUMENTEN (of met \`args: {}\`). Geen tekst.
    2.  Nadat je de schema output hebt, MOET je VOLGENDE AIMessage ALLEEN een tool_call bevatten voor 'create_ticket_in_notion'.
    De \`args\` voor de tool call moeten een object zijn met één key, "input". De waarde van "input" is een JSON *string*.
    Deze JSON string moet, wanneer geparsed, een plat object zijn. Het binnenste platte object (na parsen van de string) ziet er bijvoorbeeld zo uit:
    \`\`\`json
    {
      "announce_status": true,
      "Onderwerp": "Test Ticket van Bot",
      "Omschrijving": "Dit is een automatisch gegenereerd testticket.",
      "Gemeld door": "IT Bot Test",
      "Prioriteit": "EenVALIDEoptieUitSchema", 
      "Categorie": "EenVALIDEoptieUitSchema"  
      }
      \`\`\`
    Dus de volledige \`args\` voor de tool call is: \`args: { "input": "JSON_STRING_VAN_BOVENSTAAND_OBJECT" }\`.
    Gebruik valide waarden voor "Prioriteit" en "Categorie" gebaseerd op het schema dat je hebt ontvangen.
3.  Nadat die tool is uitgevoerd, geef je in een AIMessage met ALLEEN content het resultaat (ticket URL of fout).

**Tool Aanroep Details (jouw interne kennis):**
*   Voor 'get_notion_database_schema': Roep aan zonder argumenten (of met \`args: {}\`). Output is JSON. Statusbericht wordt automatisch verstuurd.
*   Voor 'create_ticket_in_notion': De tool verwacht argumenten in de vorm \`{ "input": "JSON_STRING_VAN_PLAT_OBJECT" }\`.
De JSON_STRING_VAN_PLAT_OBJECT bevat de ticket properties en optioneel 'announce_status'.
*   Binnen de geparsede JSON string: Keys = exacte property namen uit het schema (bv. "Onderwerp").
*   Binnen de geparsede JSON string: Values = simpele gebruikersdata. **Lever GEEN geneste Notion API JSON structuur als value.**

**BELANGRIJKE REGEL VOOR HERHAALDE ACTIES:**
Wanneer een gebruiker vraagt om een actie te herhalen die tools vereist (zoals "maak nog een ticket", "doe dat nog eens", "nog eentje" in de context van een ticket), moet je ALTIJD de volledige tool-aanroepsequentie (e.g., 'get_notion_database_schema' gevolgd door 'create_ticket_in_notion') opnieuw starten.
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

// src/lib/langchainClient.js
// Functie: customToolExecutorNodeLogic

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
            // VERWIJDERD: console.log(`[ToolExecutor - Chat ${chatIdForTools}] Statusbericht voor ${toolToExecute.name} verzonden.`);
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
                // VERWIJDERD: console.log(`[ToolExecutor - Chat ${chatIdForTools}] Statusbericht voor ${toolToExecute.name} verzonden (announce_status).`);
              }
            } catch (e) {
              /* ignore parse error for status */
            }
          }
        } else {
          processedArgsForToolInvoke = rawLlmArgs;
        }

        if (observation === undefined) {
          // VERWIJDERD: console.log(`[LangGraph] Uitvoeren tool '${toolCall.name}'...`);
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
        console.error(`[LangGraph] FOUT bij tool ${toolCall.name}: ${error.message}`); // FOUTEN BLIJVEN!
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
      console.warn(`[LangGraph] Tool niet gevonden: ${toolCall.name}`); // WAARSCHUWINGEN BLIJVEN!
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
  ); // Korte input log

  const statusUpdateHandler = new TelegramStatusUpdateHandler(chatId); // NIEUW: Instantieer handler

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
      // Als er al een SystemMessage is (bv. door vorige debug), vervang deze met de laatste versie.
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
          callbacks: [statusUpdateHandler], // VOEG TOE
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

      // Als de LLM alleen een tool call doet en geen tekstuele content stuurt,
      // dan is botResponseText hier leeg. textMessageHandler zal dan niets sturen.
      // De status update komt van de TelegramStatusUpdateHandler.
      if (
        botResponseText.trim() === "" &&
        lastAiMessage.tool_calls &&
        lastAiMessage.tool_calls.length > 0
      ) {
        console.log(
          `[LangGraph - Chat ${chatId}] LLM gaf geen tekstuele content, alleen tool_calls. Statusupdates via handler.`
        );
        return ""; // Retourneer lege string, textMessageHandler zal dit afhandelen.
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
      error.cause // Log de oorzaak als die er is
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
    // De callback handler kan een error message sturen voor tool errors.
    // Dit is voor algemene LangGraph errors.
    return userMessage;
  }
}

console.log(` - Langchain client (LangGraph) geïnitialiseerd met model: ${GEMINI_MODEL_NAME}.`);

module.exports = {
  getLangchainResponse,
};
