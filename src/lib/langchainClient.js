// src/lib/langchainClient.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const { AIMessage, HumanMessage, ToolMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, END, START } = require("@langchain/langgraph");
const { getChatMessages } = require("./supabaseClient");
const { tools, toolsDescription, toolNames } = require("./tools");
const { NOTION_DATABASE_ID } = require("../config");

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
5.  **Ticket Creatie Proces (jouw interne proces):**
    *   **Na bevestiging van de gebruiker ("ja", "is goed", etc.):**
        A.  Gebruik **onmiddellijk** intern de tool 'get_notion_database_schema'.
        B.  Analyseer het schema intern. Leid "Onderwerp", "Omschrijving", "Gemeld door" (de naam die de gebruiker zojuist heeft gegeven of eerder in het gesprek) af uit het gesprek.
        C.  Schat "Prioriteit" en "Categorie" intern in. Laat "Categorie" leeg als onduidelijk. Vraag deze velden niet standaard uit.
        D.  Als essentiële informatie voor "Onderwerp", "Omschrijving" of "Gemeld door" nog mist na de bevestiging, stel dan nu één, maximaal twee, korte, gerichte vragen om deze aan te vullen.
        E.  Zodra je de minimaal benodigde informatie hebt (zeker Onderwerp en Gemeld door), zeg **alleen**: "Oké, ik ga het ticket nu aanmaken." en roep **onmiddellijk** de tool 'create_ticket_in_notion' aan. Geef GEEN samenvatting van de ticketdetails aan de gebruiker voordat de tool is aangeroepen.
    *   **Na de tool call:**
        F.  Als 'create_ticket_in_notion' een URL retourneert: "Ticket [URL] is aangemaakt."
        G.  Als de tool een foutmelding geeft: "Het aanmaken van het ticket is helaas niet gelukt: [foutmelding van tool]." of "Er ging iets mis bij het aanmaken van het ticket."
        H.  Geef GEEN URL als de tool geen succesvolle URL heeft teruggegeven.

**Interactievoorbeelden (hoe JIJ als bot reageert - de gebruiker ziet alleen jouw antwoorden):**

*Voorbeeld 1: Simpel probleem, doorverwijzen naar ticket*
    *Gebruiker:* "Mijn mail doet het niet meer want zit vol."
    *Jij:* "Vervelend dat je mail vol zit. Krijg je een specifieke melding?"
    *Gebruiker:* "Ja, limiet bereikt."
    *Jij:* "Dat is duidelijk. Zal ik hiervoor een ticket aanmaken zodat een collega je mailbox kan aanpassen?"
    *Gebruiker:* "Ja graag, spoed."
    *Jij:* "Oké. Wie mag ik noteren als melder?"
    *Gebruiker:* "Lianne Post."
    *Jij:* "Oké, ik ga het ticket nu aanmaken."
        *   *(Intern: LLM roept direct get_notion_database_schema, dan create_ticket_in_notion met 'Onderwerp': "Mailbox vol", 'Omschrijving': "Limiet bereikt", 'Gemeld door': "Lianne Post", 'Prioriteit': "Hoog", 'Categorie': "Quick-win".)*
    *Jij (na succesvolle tool call):* "Ticket [URL] is aangemaakt voor je volle mailbox."

*Voorbeeld 2: Probleem met applicatie, details verzamelen*
    *Gebruiker:* "Facturen blijven op de status 'open' staan en worden niet automatisch verzonden in Claever."
    *Jij:* "Dat is niet handig. Merk je dit bij alle facturen of bij specifieke?"
    *Gebruiker:* "Sommige wel, sommige niet. Kvarøy wel, Seaborn niet."
    *Jij:* "Bedankt voor die info. Zal ik een ticket maken zodat de Claever specialisten dit kunnen uitzoeken?"
    *Gebruiker:* "Ja, graag."
    *Jij:* "Wie mag ik noteren als melder?"
    *Gebruiker:* "Wypke Metz."
    *Jij:* "Oké, ik ga het ticket nu aanmaken."
        *   *(Intern: LLM roept direct tools aan met relevante info.)*
    *Jij (na succes):* "Ticket [URL] voor het factuurprobleem is aangemaakt."


**Speciale Instructie voor Testen (Alleen als de gebruiker expliciet om een 'test ticket' vraagt):**
Als de gebruiker expliciet vraagt om een "test ticket", roep dan **onmiddellijk** de tools aan (eerst schema, dan ticket creatie met zelfverzonnen, complete data). Geef daarna het resultaat.

**Tool Aanroep Details (jouw interne kennis):**
*   Voor 'get_notion_database_schema': Roep aan zonder argumenten. Output is JSON.
*   Voor 'create_ticket_in_notion': Input is een JSON object.
    *   Keys = exacte property namen uit het schema.
    *   Values = simpele gebruikersdata. **Lever GEEN geneste Notion API JSON structuur als value.** Voorbeeld GOEDE tool call input: \`{"Onderwerp": "VPN Fout", "Omschrijving": "Timeout.", "Gemeld door": "Jan", "Prioriteit": "Hoog", "Categorie": "Quick-win"}\`

Wanneer je een tool aanroept, krijg je de output (Observation) in de volgende stap. Baseer je antwoord aan de gebruiker ALLEEN op die daadwerkelijke observatie.`;

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
  ],
  temperature: 0.7,
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
  console.log("[LangGraph] callAgentLogic: Start");

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
      `[LangGraph] callAgentLogic: LLM stelt tool call(s) voor: ${llmResponse.tool_calls
        .map((tc) => tc.name)
        .join(", ")}`
    );
  } else {
    console.log("[LangGraph] callAgentLogic: LLM geeft direct antwoord.");
  }

  return {
    chat_history: [llmResponse],
    input: null,
  };
}

// --- CUSTOM TOOL EXECUTOR NODE --- standaard tool van lanchain geeft problemen met executeNode
async function customToolExecutorNodeLogic(state) {
  console.log("[LangGraph] customToolExecutorNodeLogic: Start");
  const lastMessage = state.chat_history[state.chat_history.length - 1];
  const toolMessages = [];

  if (lastMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    console.log(
      `[LangGraph] customToolExecutorNodeLogic: Verwerken ${lastMessage.tool_calls.length} tool call(s).`
    );

    for (const toolCall of lastMessage.tool_calls) {
      const toolToExecute = tools.find((t) => t.name === toolCall.name);
      if (toolToExecute) {
        let observation;
        try {
          console.log(
            `[LangGraph] customToolExecutorNodeLogic: Uitvoeren tool '${
              toolCall.name
            }' met args: ${JSON.stringify(toolCall.args)}`
          );
          observation = await toolToExecute.invoke(toolCall.args);
          console.log(
            `[LangGraph] customToolExecutorNodeLogic: Observatie van tool '${
              toolCall.name
            }': "${String(observation).substring(0, 100)}${
              String(observation).length > 100 ? "..." : ""
            }"`
          );
          toolMessages.push(
            new ToolMessage({
              content: String(observation),
              tool_call_id: toolCall.id,
              name: toolCall.name,
            })
          );
        } catch (error) {
          console.error(
            `[LangGraph] customToolExecutorNodeLogic: Fout bij uitvoeren tool ${toolCall.name}:`,
            error.message
          );
          toolMessages.push(
            new ToolMessage({
              content: `Fout bij uitvoeren tool ${toolCall.name}: ${error.message}`,
              tool_call_id: toolCall.id,
              name: toolCall.name,
            })
          );
        }
      } else {
        console.warn(
          `[LangGraph] customToolExecutorNodeLogic: Tool niet gevonden: ${toolCall.name}`
        );
        toolMessages.push(
          new ToolMessage({
            content: `Tool ${toolCall.name} niet gevonden.`,
            tool_call_id: toolCall.id,
            name: toolCall.name,
          })
        );
      }
    }
  } else {
    console.warn(
      "[LangGraph] customToolExecutorNodeLogic: Geen tool calls gevonden in laatste bericht, hoewel deze node is aangeroepen."
    );
  }
  return {
    chat_history: toolMessages,
  };
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
    `[LangGraph - Chat ${chatId}] Verzoek voor input: "${userInput.substring(0, 50)}${
      userInput.length > 50 ? "..." : ""
    }"`
  );

  try {
    const dbMessages = await getChatMessages(chatId, CHAT_HISTORY_MESSAGE_LIMIT);
    // Reconstructie wordt simpeler, geen metadata checks voor tool_calls etc.
    const initialChatHistory = dbMessages
      .map((msg) => {
        if (!msg) return null;
        if (msg.sender_role === "user") return new HumanMessage({ content: msg.content });
        if (msg.sender_role === "assistant" || msg.sender_role === "model") {
          return new AIMessage({ content: msg.content }); // Geen tool_calls herstel
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
      runTimeChatHistory.push(...initialChatHistory.slice(-CHAT_HISTORY_MESSAGE_LIMIT));
    }

    const finalState = await compiledGraphApp.invoke(
      { input: userInput, chat_history: [...runTimeChatHistory] },
      { recursionLimit: 10, configurable: { thread_id: String(chatId) } }
    );

    const lastAiMessage = finalState.chat_history.filter((m) => m instanceof AIMessage).pop();

    if (
      lastAiMessage &&
      (typeof lastAiMessage.content === "string" ||
        (Array.isArray(lastAiMessage.content) &&
          lastAiMessage.content.some((c) => c.type === "text")))
    ) {
      if (
        lastAiMessage.tool_calls &&
        lastAiMessage.tool_calls.length > 0 &&
        typeof lastAiMessage.content === "string" &&
        lastAiMessage.content.trim() === ""
      ) {
        console.warn(
          `[LangGraph - Chat ${chatId}] Graaf eindigde met een AIMessage die alleen tool_calls heeft en geen tekstuele content.`
        );
        return "Ik ben bezig met het verwerken van je verzoek met een tool, een ogenblikje...";
      }

      let botResponseText = "";
      if (typeof lastAiMessage.content === "string") {
        botResponseText = lastAiMessage.content;
      } else if (Array.isArray(lastAiMessage.content)) {
        botResponseText = lastAiMessage.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
      }

      console.log(
        `[LangGraph - Chat ${chatId}] Succesvol antwoord: "${botResponseText.substring(0, 50)}${
          botResponseText.length > 50 ? "..." : ""
        }"`
      );
      return botResponseText;
    } else {
      console.error(
        `[LangGraph - Chat ${chatId}] Geen geldig antwoord (tekstuele content) gevonden in finale AIMessage.`
      );
      return "Sorry, ik kon geen bruikbaar antwoord genereren op dit moment.";
    }
  } catch (error) {
    console.error(
      `[LangGraph - Chat ${chatId}] Fout in getLangchainResponse: ${error.message}`,
      error.stack,
      error.cause
    );
    let userMessage = "Sorry, er ging iets mis bij het verwerken van uw vraag via Langchain.";
    if (error.message && error.message.toLowerCase().includes("safety")) {
      userMessage = "Sorry, ik kan geen antwoord genereren vanwege de veiligheidsinstellingen.";
    } else if (error.message && error.message.toLowerCase().includes("recursion")) {
      userMessage =
        "Sorry, het lijkt erop dat ik in een lus terecht ben gekomen. Kun je de vraag anders formuleren?";
    }
    return userMessage;
  }
}

console.log(` - Langchain client (LangGraph) geïnitialiseerd met model: ${GEMINI_MODEL_NAME}.`);

module.exports = {
  getLangchainResponse,
};
