import { OutreachInputError } from "./domain";

export async function readLimitedJson(request: Request, maxBytes = 262_144): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new OutreachInputError("JSON required", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new OutreachInputError("Event too large", 413);
  if (!request.body) throw new OutreachInputError("Body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new OutreachInputError("Event too large", 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof OutreachInputError) throw error;
    throw new OutreachInputError("Invalid JSON");
  } finally { reader.releaseLock(); }
}
