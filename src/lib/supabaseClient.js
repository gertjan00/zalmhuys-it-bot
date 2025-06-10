// src/lib/supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "FATAL: Supabase URL of SUPABASE_SERVICE_ROLE_KEY niet ingesteld in environment voor supabaseClient.js!"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log(" - Supabase client geïnitialiseerd.");

async function saveChatMessage(chatId, userId, messageId, senderRole, content, metadata = null) {
  const functionName = "save-chat-message";
  try {
    const { data, error } = await supabase
      .from("chat_history")
      .insert([
        {
          chat_id: chatId,
          user_id: userId,
          message_id: messageId,
          sender_role: senderRole,
          content: content,
          metadata: metadata || null,
        },
      ])
      .select("id")
      .single();

    if (error) {
      console.error(
        `[SupabaseClient] Fout bij opslaan bericht: ${error.message}. ChatID: ${chatId}, MsgID: ${messageId}`,
        error
      );
      if (error.code === "23505") {
        console.warn(
          `[SupabaseClient] Bericht (chat: ${chatId}, msg: ${messageId}) al opgeslagen (unique constraint).`
        );
      }
      return null;
    }
    return data;
  } catch (e) {
    console.error(
      `[SupabaseClient] Onverwachte JS fout in saveChatMessage: ${e.message}. ChatID: ${chatId}, MsgID: ${messageId}`
    );
    return null;
  }
}

async function getChatMessages(chatId, limit = 10) {
  try {
    const { data, error } = await supabase
      .from("chat_history")
      .select("sender_role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false }) // Nieuwste eerst
      .limit(limit);

    if (error) {
      console.error(
        `[SupabaseClient] Fout bij ophalen recente berichten: ${error.message}. ChatID: ${chatId}`
      );
      return [];
    }
    // Keer de volgorde om zodat ze chronologisch zijn (oudste eerst) voor Langchain
    return data ? data.reverse() : [];
  } catch (e) {
    console.error(
      `[SupabaseClient] Onverwachte JS fout in getRecentChatMessages: ${e.message}. ChatID: ${chatId}`
    );
    return [];
  }
}

module.exports = {
  saveChatMessage,
  getChatMessages,
};
