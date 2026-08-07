import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/customer-service/leads/webhook/route";

const originalLegacySecret = process.env.LEADS_WEBHOOK_SECRET;

afterEach(() => {
  if (originalLegacySecret === undefined) delete process.env.LEADS_WEBHOOK_SECRET;
  else process.env.LEADS_WEBHOOK_SECRET = originalLegacySecret;
});

describe("POST /api/customer-service/leads/webhook", () => {
  it("rejects the retired browser-visible shared secret", async () => {
    process.env.LEADS_WEBHOOK_SECRET = "legacy-secret";
    const response = await POST(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads/webhook" +
        "?source=website&secret=legacy-secret",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { email: "jane@example.com" } }),
      },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
