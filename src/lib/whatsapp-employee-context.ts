import { timingSafeEqual } from "node:crypto";

export function normalizeWhatsAppPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function isValidWhatsAppAssistantSecret(value: string | null): boolean {
  const configured = process.env.WHATSAPP_ASSISTANT_SHARED_SECRET;
  if (!configured || !value?.startsWith("Bearer ")) return false;

  const provided = value.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
