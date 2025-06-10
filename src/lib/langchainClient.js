// src/lib/langchainClient.js
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const { ConversationChain } = require("langchain/chains");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} = require("@langchain/core/prompts");
const { BufferMemory, ChatMessageHistory } = require("langchain/memory");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const { getChatMessages } = require("./supabaseClient"); // Alleen voor history laden

const SYSTEM_INSTRUCTION_TEXT = `Jij bent Zalmhuys IT Bot. Je bent een vriendelijke en professionele AI-assistent gespecialiseerd in het beantwoorden van IT-gerelateerde vragen voor medewerkers van Zalmhuys. Geef duidelijke en beknopte antwoorden. Als je een vraag niet kunt beantwoorden, geef dan aan dat je het niet weet en adviseer eventueel contact op te nemen met de IT-afdeling. Antwoord in het Nederlands. Gebruik geen markdown, tenzij het expliciet gevraagd wordt of noodzakelijk is voor de duidelijkheid (bijv. codeblokken of lijsten).`;
const GEMINI_MODEL_NAME = "gemini-2.0-flash";
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
  temperature: 0.8,
});

const promptTemplate = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(SYSTEM_INSTRUCTION_TEXT),
  new MessagesPlaceholder("history"),
  HumanMessagePromptTemplate.fromTemplate("{input}"),
]);

const chatChains = new Map();

async function getConversationChain(chatId) {
  if (chatChains.has(chatId)) {
    return chatChains.get(chatId);
  }

  const dbMessages = await getChatMessages(chatId, CHAT_HISTORY_MESSAGE_LIMIT);
  const pastMessages = dbMessages
    .map((msg) => {
      if (msg.sender_role === "user") {
        return new HumanMessage(msg.content);
      } else if (msg.sender_role === "assistant" || msg.sender_role === "model") {
        return new AIMessage(msg.content);
      }
      return null;
    })
    .filter(Boolean);

  const memory = new BufferMemory({
    chatHistory: new ChatMessageHistory(pastMessages),
    returnMessages: true,
    memoryKey: "history",
    inputKey: "input",
  });

  const chain = new ConversationChain({
    memory: memory,
    prompt: promptTemplate,
    llm: llm,
    verbose: process.env.NODE_ENV === "development",
  });

  chatChains.set(chatId, chain);
  return chain;
}

async function getLangchainResponse(chatId, userInput) {
  try {
    const chain = await getConversationChain(chatId);
    const result = await chain.invoke({ input: userInput });

    const botResponse = result.response;

    if (!botResponse) {
      console.error(`[LangchainClient - Chat ${chatId}] Geen response van chain. Result:`, result);
      return "Sorry, er ging iets mis bij het genereren van een antwoord (geen output).";
    }

    return botResponse;
  } catch (error) {
    console.error(
      `[LangchainClient - Chat ${chatId}] Fout bij getLangchainResponse:`,
      error.message,
      error.stack
    );
    if (error.response && error.response.promptFeedback) {
      console.error(
        "Gemini Prompt Feedback:",
        JSON.stringify(error.response.promptFeedback, null, 2)
      );
    }
    return "Sorry, er ging iets mis bij het verwerken van uw vraag via Langchain.";
  }
}

function clearChatCache(chatId) {
  if (chatChains.has(chatId)) {
    chatChains.delete(chatId);
    console.log(`[LangchainClient - Chat ${chatId}] Cache gewist.`);
  }
}

console.log(` - Langchain client geïnitialiseerd met model: ${GEMINI_MODEL_NAME}.`);

module.exports = {
  getLangchainResponse,
  clearChatCache,
};
