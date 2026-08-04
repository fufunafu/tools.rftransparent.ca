import { z } from "zod";
import { ASSISTANT_INITIAL_PROMPT_MAX_LENGTH } from "@/lib/assistant-knowledge";
import { getSetting, putSetting } from "@/lib/settings";

const ASSISTANT_INITIAL_PROMPT_KEY = "assistant_initial_prompt";

export const DEFAULT_ASSISTANT_INITIAL_PROMPT = `You are RF Transparent's WhatsApp employee assistant. Answer employee questions using only the approved company knowledge provided for the current conversation. Keep replies concise, practical, and suitable for WhatsApp. Never invent company policies, contacts, prices, schedules, or procedures. If the approved knowledge does not contain the answer, say that you do not have that information and direct the employee to their manager or the appropriate internal contact.`;

export const assistantInitialPromptSchema = z.object({
  initialPrompt: z
    .string()
    .trim()
    .min(1, "Initial prompt is required")
    .max(
      ASSISTANT_INITIAL_PROMPT_MAX_LENGTH,
      `Initial prompt must be ${ASSISTANT_INITIAL_PROMPT_MAX_LENGTH.toLocaleString()} characters or fewer`,
    ),
});

export async function getAssistantInitialPrompt(): Promise<string> {
  const stored = await getSetting<unknown>(
    ASSISTANT_INITIAL_PROMPT_KEY,
    DEFAULT_ASSISTANT_INITIAL_PROMPT,
  );
  const parsed = assistantInitialPromptSchema.shape.initialPrompt.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT_INITIAL_PROMPT;
}

export async function putAssistantInitialPrompt(initialPrompt: string): Promise<string> {
  const parsed = assistantInitialPromptSchema.shape.initialPrompt.parse(initialPrompt);
  await putSetting(ASSISTANT_INITIAL_PROMPT_KEY, parsed);
  return parsed;
}
