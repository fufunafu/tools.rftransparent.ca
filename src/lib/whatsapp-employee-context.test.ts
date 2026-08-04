import { afterEach, describe, expect, it } from "vitest";
import {
  isValidWhatsAppAssistantSecret,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp-employee-context";

afterEach(() => {
  delete process.env.WHATSAPP_ASSISTANT_SHARED_SECRET;
});

describe("normalizeWhatsAppPhone", () => {
  it("normalizes common international phone formats", () => {
    expect(normalizeWhatsAppPhone("+1 (416) 613-4388")).toBe("14166134388");
    expect(normalizeWhatsAppPhone("1-800-549-0162")).toBe("18005490162");
  });

  it("rejects missing and implausible phone numbers", () => {
    expect(normalizeWhatsAppPhone("unknown")).toBeNull();
    expect(normalizeWhatsAppPhone("555")).toBeNull();
  });
});

describe("isValidWhatsAppAssistantSecret", () => {
  it("fails closed when the secret is missing", () => {
    expect(isValidWhatsAppAssistantSecret("Bearer anything")).toBe(false);
  });

  it("accepts only the exact configured bearer secret", () => {
    process.env.WHATSAPP_ASSISTANT_SHARED_SECRET = "shared-secret";
    expect(isValidWhatsAppAssistantSecret("Bearer shared-secret")).toBe(true);
    expect(isValidWhatsAppAssistantSecret("Bearer wrong-secret")).toBe(false);
    expect(isValidWhatsAppAssistantSecret("shared-secret")).toBe(false);
  });
});
