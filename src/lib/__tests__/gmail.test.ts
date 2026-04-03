import { describe, it, expect } from "vitest";
import { classifyDirection, extractEmail } from "@/lib/gmail";
import type { GmailMessage } from "@/lib/gmail";

function makeMsg(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "msg1",
    threadId: "thread1",
    from: "customer@example.com",
    to: "info@glass-railing.com",
    subject: "Quote request",
    date: "2026-03-01T10:00:00Z",
    snippet: "I'd like a quote for...",
    ...overrides,
  };
}

describe("classifyDirection", () => {
  const inbox = "info@glass-railing.com";

  it("returns inbound when from is a customer", () => {
    expect(classifyDirection(makeMsg({ from: "customer@example.com" }), inbox)).toBe("inbound");
  });

  it("returns outbound when from matches inbox email", () => {
    expect(classifyDirection(makeMsg({ from: "info@glass-railing.com" }), inbox)).toBe("outbound");
  });

  it("returns outbound when from contains inbox email in Name <email> format", () => {
    expect(classifyDirection(makeMsg({ from: "RF Transparent <info@glass-railing.com>" }), inbox)).toBe("outbound");
  });

  it("is case-insensitive", () => {
    expect(classifyDirection(makeMsg({ from: "INFO@GLASS-RAILING.COM" }), inbox)).toBe("outbound");
    expect(classifyDirection(makeMsg({ from: "Info@Glass-Railing.com" }), inbox)).toBe("outbound");
  });

  it("returns inbound when from is a different store email", () => {
    expect(classifyDirection(makeMsg({ from: "info@glassrailingstore.com" }), inbox)).toBe("inbound");
  });

  it("handles empty from as inbound", () => {
    expect(classifyDirection(makeMsg({ from: "" }), inbox)).toBe("inbound");
  });
});

describe("extractEmail", () => {
  it("extracts email from Name <email> format", () => {
    expect(extractEmail("John Doe <john@example.com>")).toBe("john@example.com");
  });

  it("returns raw email lowercased when no angle brackets", () => {
    expect(extractEmail("John@Example.COM")).toBe("john@example.com");
  });

  it("trims whitespace", () => {
    expect(extractEmail("  john@example.com  ")).toBe("john@example.com");
  });

  it("handles complex display names", () => {
    expect(extractEmail('"Doe, John" <john@example.com>')).toBe("john@example.com");
  });
});
