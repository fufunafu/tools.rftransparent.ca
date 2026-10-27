import { describe, expect, it, vi } from "vitest";
import { hydrateReply } from "./instantly";
import { normalizeInstantlyEvent, type OutreachConfig } from "./domain";

const config: OutreachConfig = { workspaceId: "11111111-1111-4111-8111-111111111111", campaignIds: { installer_network: "22222222-2222-4222-8222-222222222222", materials_sales: "33333333-3333-4333-8333-333333333333" }, webhookSecret: "x".repeat(40) };
const event = normalizeInstantlyEvent({ workspace: config.workspaceId, campaign_id: config.campaignIds.installer_network, timestamp: "2026-09-09T20:00:00Z", event_type: "reply_received", lead_email: "test@example.com", email_account: "sales@example.org", reply_text_snippet: "Could you", email_id: "reply-1" }, config)!;
const record = { id: "reply-1", organization_id: config.workspaceId, campaign_id: event.campaignId, lead: event.email, eaccount: event.mailbox, ue_type: 2, timestamp_email: event.occurredAt, body: { text: "Could you send an installer network application?" }, thread_id: "thread-1" };

describe("reply hydration", () => {
  it("reads the identified reply and preserves its thread", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(record));
    const result = await hydrateReply(event, "test-key", fetcher);
    expect(result.bodyComplete).toBe(true); expect(result.threadId).toBe("thread-1");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.instantly.ai/api/v2/emails/reply-1");
  });
  it.each([
    { campaign_id: config.campaignIds.materials_sales }, { lead: "another@example.com" },
    { organization_id: config.campaignIds.materials_sales }, { eaccount: "different@example.org" },
    { ue_type: 1 }, { is_auto_reply: 1 }, { id: "different-message" },
  ])("rejects reply identity mismatch %j", async (override) => {
    await expect(hydrateReply(event, "test-key", vi.fn().mockResolvedValue(Response.json({ ...record, ...override })))).rejects.toThrow("instantly_thread_mismatch");
  });
  it("does not use a later message when no email ID is supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [{ ...record, timestamp_email: "2026-09-10T20:00:00Z" }] }));
    const original = { ...event, emailId: null };
    expect(await hydrateReply(original, "test-key", fetcher)).toEqual(original);
    expect(fetcher.mock.calls[0][0]).toContain("campaign_id=");
  });
  it("leaves ambiguous and HTML-only replies in review", async () => {
    const original = { ...event, emailId: null };
    expect(await hydrateReply(original, "test-key", vi.fn().mockResolvedValue(Response.json({ items: [record, { ...record, id: "reply-2" }] })))).toEqual(original);
    expect(await hydrateReply(event, "test-key", vi.fn().mockResolvedValue(Response.json({ ...record, body: { html: "<b>Interested</b>" } })))).toEqual(event);
  });
  it("uses pagination and stops on a repeated cursor", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ items: [], next_starting_after: "cursor-1" }));
    const original = { ...event, emailId: null };
    expect(await hydrateReply(original, "test-key", fetcher)).toEqual(original);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not expose provider errors or credentials", async () => {
    await expect(hydrateReply(event, "secret", vi.fn().mockResolvedValue(new Response("private provider message", { status: 403 })))).rejects.toThrow("instantly_http_403");
  });
  it("does not make unnecessary API calls", async () => {
    const fetcher = vi.fn();
    expect(await hydrateReply(event, undefined, fetcher)).toEqual(event);
    await hydrateReply({ ...event, bodyComplete: true }, "test-key", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
