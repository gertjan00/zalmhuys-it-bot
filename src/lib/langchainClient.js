// src/lib/langchainClient.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const { AIMessage, HumanMessage, ToolMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, END, START } = require("@langchain/langgraph");

const { getChatMessages } = require("./supabaseClient");
const { tools, toolsDescription, toolNames } = require("./tools");

const SYSTEM_INSTRUCTION_BASE = `Jij bent Zalmhuys IT Bot, een behulpzame AI-assistent.
Beantwoord de vragen van de gebruiker zo goed en duidelijk mogelijk in het Nederlands.
Je hebt toegang tot de volgende tools:
{tools_description}

Denk stap voor stap na over wat je moet doen.
Wanneer je een tool aanroept, zal de output van die tool (de Observation) aan je worden teruggegeven in de volgende stap.
Baseer je antwoord aan de gebruiker op de observaties van de tools indien gebruikt.
Als je de vraag kunt beantwoorden zonder een tool te gebruiken, doe dat dan direct.
Als je een tool gebruikt, leg dan kort uit wat je gaat doen en waarom, en geef na de tool executie het resultaat duidelijk weer aan de gebruiker.`;

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

// --- CUSTOM TOOL EXECUTOR NODE --- standaard tool van lanchain gaf probleme
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
    const initialChatHistory = dbMessages
      .map((msg) => {
        if (msg.sender_role === "user") return new HumanMessage({ content: msg.content });
        if (msg.sender_role === "assistant" || msg.sender_role === "model") {
          let aiMsgContent = msg.content;
          let toolCalls;
          if (msg.metadata && msg.metadata.tool_calls) toolCalls = msg.metadata.tool_calls;
          return toolCalls
            ? new AIMessage({ content: aiMsgContent || "", tool_calls: toolCalls })
            : new AIMessage({ content: aiMsgContent });
        }
        if (msg.sender_role === "tool") {
          if (msg.metadata && msg.metadata.tool_call_id) {
            return new ToolMessage({
              content: msg.content,
              tool_call_id: msg.metadata.tool_call_id,
              name: msg.metadata.name,
            });
          }
          return new ToolMessage({
            content: msg.content,
            tool_call_id: `tool_call_id_placeholder_${Date.now()}`,
          });
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
      { input: userInput, chat_history: runTimeChatHistory },
      { recursionLimit: 10 }
    );

    const lastAiMessage = finalState.chat_history.filter((m) => m instanceof AIMessage).pop();

    if (lastAiMessage && lastAiMessage.content) {
      if (lastAiMessage.tool_calls && lastAiMessage.tool_calls.length > 0) {
        console.warn(
          `[LangGraph - Chat ${chatId}] Graaf eindigde, maar laatste AIMessage heeft nog tool_calls.`
        );
        return "Er is een onverwachte situatie opgetreden. Probeer het opnieuw.";
      }
      const botResponse = String(lastAiMessage.content);
      console.log(
        `[LangGraph - Chat ${chatId}] Succesvol antwoord: "${botResponse.substring(0, 50)}${
          botResponse.length > 50 ? "..." : ""
        }"`
      );
      return botResponse;
    } else {
      console.error(`[LangGraph - Chat ${chatId}] Geen geldig antwoord gevonden in finale state.`);
      return "Sorry, ik kon geen antwoord genereren op dit moment (geen content).";
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

function clearChatCache(chatId) {
  console.log();
}

console.log(` - Langchain client (LangGraph) geïnitialiseerd met model: ${GEMINI_MODEL_NAME}.`);

module.exports = {
  getLangchainResponse,
  clearChatCache,
};
