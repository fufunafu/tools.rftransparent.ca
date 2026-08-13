export const INTERNATIONAL_PHONE_ERROR =
  "Enter an international WhatsApp number, such as +1 514 555 0000.";

// Copying a number from a rich-text or right-to-left source can append
// invisible direction controls. They do not change the number and should not
// make an otherwise valid E.164 value fail validation.
const INVISIBLE_FORMATTING = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const DISPLAY_SEPARATORS = /[\s().-]/g;

export function normalizeInternationalPhone(value: string): string {
  const cleaned = value.trim().replace(INVISIBLE_FORMATTING, "");
  if (!cleaned.startsWith("+")) throw new Error(INTERNATIONAL_PHONE_ERROR);

  const digits = cleaned.slice(1).replace(DISPLAY_SEPARATORS, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error(INTERNATIONAL_PHONE_ERROR);
  }

  return `+${digits}`;
}

export function normalizeOptionalInternationalPhone(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(INTERNATIONAL_PHONE_ERROR);
  if (!value.trim()) return null;
  return normalizeInternationalPhone(value);
}

export function getInternationalPhoneError(value: string): string | null {
  if (!value.trim()) return null;
  try {
    normalizeInternationalPhone(value);
    return null;
  } catch {
    return INTERNATIONAL_PHONE_ERROR;
  }
}
