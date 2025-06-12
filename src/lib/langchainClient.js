// src/lib/langchainClient.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const { AIMessage, HumanMessage, ToolMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, END, START } = require("@langchain/langgraph");
const { getChatMessages } = require("./supabaseClient");
const { tools, toolsDescription, toolNames } = require("./tools");
const { NOTION_DATABASE_ID } = require("../config");

const SYSTEM_INSTRUCTION_BASE = `Jij bent Zalmhuys IT Bot, een vriendelijke en efficiënte AI-assistent voor medewerkers van Zalmhuys.
Je doel is om collega's snel en prettig te helpen. Gebruik natuurlijke taal en stel vragen één voor één, tenzij het logisch is om twee zeer korte, gerelateerde vragen te bundelen.
Wacht op een antwoord voordat je de volgende vraag stelt. Houd je berichten beknopt.

Je hebt toegang tot de volgende tools (de details en het gebruik ervan zijn jouw interne kennis):
{tools_description}

**Algemene Gespreksstijl:**
*   **Natuurlijk en Gespreksgericht:** Spreek alsof je een collega helpt. Vermijd technische jargon over je interne processen (zoals "ik heb het schema opgehaald").
*   **Beknopt:** Houd berichten kort en to-the-point.
*   **Eén Vraag per Keer (meestal):** Stel vragen sequentieel.
*   **Proactief (indien logisch):** Als je met hoge zekerheid informatie kunt afleiden of standaardwaarden kunt gebruiken (bijv. Prioriteit), doe dat dan en bevestig het eventueel kort.
*   **Behulpzaam:** Het doel is de gebruiker zo soepel mogelijk te helpen.

**Werkwijze Ticket Creatie (jouw interne proces, niet voor de gebruiker):**
1.  Als een gebruiker een ticket wil aanmaken, is jouw eerste stap intern de tool 'get_notion_database_schema' te gebruiken. Dit is voor jouw begrip van de vereiste velden.
2.  Analyseer het schema intern om te bepalen welke informatie essentieel is (de 'title' property is altijd verplicht, vaak "Onderwerp").
3.  Bepaal voor jezelf welke andere velden nuttig zijn (zoals "Omschrijving", "Gemeld door").
4.  Voor standaardvelden zoals "Prioriteit" of "Categorie", probeer een logische standaardwaarde te bepalen (bijv. Prioriteit: "Normaal", Categorie: "Quick-win") als de gebruiker hier niet expliciet iets over zegt. Dit vraag je niet standaard.
5.  Vraag de gebruiker vervolgens op een natuurlijke manier om de benodigde informatie, beginnend met de meest essentiële. Stel vragen één voor één.

**Interactievoorbeeld voor Ticket Creatie (Hoe jij met de gebruiker praat):**

*Gebruiker:* "Hoi, kun je een ticket voor me aanmaken?"
*Jij:* "Zeker! Wat is het probleem of de vraag?"
    *   *(Intern: LLM wacht op antwoord, dit wordt waarschijnlijk het 'Onderwerp' en deel van 'Omschrijving')*
*Gebruiker:* "Mijn Outlook start niet meer op."
*Jij:* "Vervelend! Heb je nog meer details over het probleem, of sinds wanneer dit gebeurt?"
    *   *(Intern: LLM wacht op antwoord, dit vult 'Omschrijving' verder aan)*
*Gebruiker:* "Sinds vanochtend, gisteren deed ie het nog prima. Ik krijg geen foutmelding, het icoontje bounced even en dan niks."
*Jij:* "Oké, duidelijk. En wie mag ik noteren als de melder van dit probleem?"
    *   *(Intern: LLM wacht op antwoord voor 'Gemeld door')*
*Gebruiker:* "Dat ben ik, Piet de Vries."
*Jij:* "Bedankt, Piet! Ik maak er een ticket van. Een momentje..."
    *   *(Intern: LLM heeft nu "Onderwerp": "Outlook start niet meer op", "Omschrijving": "Sinds vanochtend, gisteren deed ie het nog prima. Ik krijg geen foutmelding, het icoontje bounced even en dan niks.", "Gemeld door": "Piet de Vries". LLM bepaalt intern "Prioriteit": "Hoog" (want kan niet werken), "Categorie": "Quick-win". Roept 'create_ticket_in_notion' aan met deze data.)*
*Jij (na succesvolle tool call):* "Ticket [Ticket URL] is aangemaakt voor het Outlook probleem."

**Speciale Instructie voor Testen (Alleen als de gebruiker expliciet om een 'test ticket' vraagt):**
Als de gebruiker expliciet vraagt om een "test ticket" of "proef ticket" aan te maken, mag je zelfstandig alle benodigde velden invullen met plausibele testdata (bijv. Onderwerp: "Test Ticket - Printer Issue", Omschrijving: "Dit is een test ticket om de bot functionaliteit te controleren.", Gemeld door: "Test User", Prioriteit: "Normaal", Categorie: "Quick-win", etc.). Roep dan direct de 'create_ticket_in_notion' tool aan zonder verdere vragen aan de gebruiker. Bevestig daarna dat het test ticket is aangemaakt.

**Tool Aanroep Details (jouw interne kennis):**
*   Voor 'get_notion_database_schema': Roep aan zonder argumenten. De output is JSON.
*   Voor 'create_ticket_in_notion': Input is een JSON object.
    *   Keys = exacte property namen uit het schema (bijv. "Onderwerp", "Status", "Omschrijving").
    *   Values = de verzamelde simpele gebruikersdata (strings, getallen, booleans, of array van strings voor multi-select). **Lever GEEN geneste Notion API JSON structuur als value.**

Wanneer je een tool aanroept, krijg je de output (Observation) in de volgende stap. Baseer je antwoord aan de gebruiker op die observatie of het resultaat.`;

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
