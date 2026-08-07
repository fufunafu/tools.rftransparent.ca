import OpenAI from "openai";

export interface AssistantConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// Greetings and acknowledgements in English and French. A message made up
// entirely of these words is conversation, not a knowledge question — it
// should be answered from the prompt, never searched or logged as a gap.
const SMALLTALK_WORDS = new Set([
  "hey", "hi", "hello", "yo", "hiya", "howdy", "sup",
  "ok", "okay", "k", "kk", "okk", "sure", "fine", "alright",
  "yes", "yep", "yeah", "ya", "yup", "no", "nope", "nah",
  "thanks", "thank", "you", "thx", "ty", "please", "pls",
  "cool", "good", "great", "nice", "perfect", "awesome", "sounds",
  "lol", "haha", "hehe",
  "bye", "goodbye", "night", "morning", "afternoon", "evening", "gm", "gn",
  "bonjour", "salut", "allo", "allô", "bonsoir", "coucou",
  "merci", "beaucoup", "oui", "non", "ouais",
  "parfait", "super", "excellent", "daccord", "dac", "bien", "ca", "ça", "va",
  "bonne", "nuit", "journée", "journee", "soirée", "soiree", "plus", "bientôt", "bientot",
]);

export function isSmalltalkMessage(message: string): boolean {
  const words = message
    .toLocaleLowerCase("en-CA")
    .replace(/[’']/g, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  // Nothing but punctuation or emoji counts as smalltalk too (e.g. "👍").
  if (words.length === 0) return true;
  if (words.length > 4) return false;
  return words.every((word) => SMALLTALK_WORDS.has(word));
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
