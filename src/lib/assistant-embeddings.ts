import OpenAI from "openai";

export const ASSISTANT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_ASSISTANT_EMBEDDING_MODEL = "text-embedding-3-small";

export async function createAssistantEmbedding(
  input: string,
  safetyIdentifier?: string,
): Promise<{ embedding: number[]; model: string }> {
  const result = await createAssistantEmbeddings([input], safetyIdentifier);
  const embedding = result.embeddings[0];
  if (!embedding) throw new Error("Embedding service returned no vector");
  return { embedding, model: result.model };
}

export async function createAssistantEmbeddings(
  inputs: string[],
  safetyIdentifier?: string,
): Promise<{ embeddings: number[][]; model: string }> {
  if (inputs.length === 0) return { embeddings: [], model: DEFAULT_ASSISTANT_EMBEDDING_MODEL };
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim()
    || DEFAULT_ASSISTANT_EMBEDDING_MODEL;
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 15000 });
  const response = await client.embeddings.create({
    model,
    dimensions: ASSISTANT_EMBEDDING_DIMENSIONS,
    input: inputs.map((input) => input.trim().slice(0, 24000)),
    ...(safetyIdentifier ? { user: safetyIdentifier } : {}),
  });
  const embeddings = [...response.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
  if (embeddings.length !== inputs.length || embeddings.some(
    (embedding) => embedding.length !== ASSISTANT_EMBEDDING_DIMENSIONS,
  )) {
    throw new Error("Embedding service returned an invalid vector");
  }
  return { embeddings, model: response.model || model };
}

export function buildAssistantKnowledgeEmbeddingInput(input: {
  title: string;
  content: string;
  category: string;
  keywords: string[];
}): string {
  return [
    `Topic: ${input.title}`,
    `Category: ${input.category}`,
    `Search terms: ${input.keywords.join(", ")}`,
    `Approved answer: ${input.content}`,
  ].join("\n");
}
