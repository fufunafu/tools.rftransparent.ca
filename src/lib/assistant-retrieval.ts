import OpenAI from "openai";

export interface AssistantConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function rewriteAssistantRetrievalQuery({
  message,
  history,
  safetyIdentifier,
}: {
  message: string;
  history: AssistantConversationMessage[];
  safetyIdentifier: string;
}): Promise<string> {
  if (history.length === 0) return message;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return message;

  try {
    const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 10000 });
    const response = await client.responses.create({
      model: process.env.OPENAI_KNOWLEDGE_QUERY_MODEL?.trim() || "gpt-5.6-luna",
      instructions: `Rewrite the latest employee WhatsApp message as one standalone knowledge-base search query. Resolve pronouns and omitted subjects from the conversation. Preserve exact company names, locations, product names, identifiers, dates, and numbers. Return only the rewritten query, with no explanation.`,
      input: JSON.stringify({
        conversation: history.slice(-6),
        latestMessage: message,
      }),
      reasoning: { effort: "low" },
      max_output_tokens: 120,
      safety_identifier: safetyIdentifier,
      store: false,
      text: { verbosity: "low" },
    });
    return response.output_text.trim().slice(0, 3000) || message;
  } catch (error) {
    console.error(
      "[whatsapp-assistant] Query rewrite failed:",
      error instanceof Error ? error.message : error,
    );
    return message;
  }
}

export function formatAssistantKnowledgeContext(entries: Array<{
  id: string;
  title: string;
  content: string;
  source_title?: string | null;
}>): string {
  if (entries.length === 0) return "";
  return entries.map((entry, index) => [
    `[Knowledge ${index + 1}: ${entry.title}]`,
    entry.content,
    `Reference: ${entry.source_title ?? entry.title} (${entry.id})`,
  ].join("\n")).join("\n\n");
}
