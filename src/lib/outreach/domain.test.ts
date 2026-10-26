import { describe, expect, it } from "vitest";
import { authoredText, explicitOptOut, getOutreachConfig, normalizeInstantlyEvent, planOutreachEvent, validWebhookToken, type OutreachConfig } from "./domain";
import { campaignDrafts } from "./campaigns";

export const testConfig: OutreachConfig = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  campaignIds: { installer_network: "22222222-2222-4222-8222-222222222222", materials_sales: "33333333-3333-4333-8333-333333333333" },
  webhookSecret: "test-only-secret-that-is-at-least-32-characters",
};
export function payload(overrides: Record<string, unknown> = {}) {
  return { workspace: testConfig.workspaceId, campaign_id: testConfig.campaignIds.installer_network,
    timestamp: "2026-09-09T20:00:00Z", event_type: "reply_received", lead_email: "Person@Example.com",
    email_account: "sales@example.org", email_id: "message-1", reply_text: "Could you send the installer network application?", ...overrides };
}

describe("Instantly intake and routing", () => {
  it("fails closed for missing, short, or overlapping configuration", () => {
    expect(getOutreachConfig({})).toBeNull();
    const env = { OUTREACH_INSTANTLY_WORKSPACE_ID: testConfig.workspaceId, OUTREACH_INSTALLER_CAMPAIGN_ID: testConfig.campaignIds.installer_network,
      OUTREACH_MATERIALS_CAMPAIGN_ID: testConfig.campaignIds.materials_sales, OUTREACH_WEBHOOK_SECRET: testConfig.webhookSecret };
    expect(getOutreachConfig(env)).toEqual(testConfig);
    expect(getOutreachConfig({ ...env, OUTREACH_MATERIALS_CAMPAIGN_ID: env.OUTREACH_INSTALLER_CAMPAIGN_ID })).toBeNull();
    expect(getOutreachConfig({ ...env, OUTREACH_WEBHOOK_SECRET: "short" })).toBeNull();
  });
  it("requires the exact webhook token", () => {
    expect(validWebhookToken(null, testConfig.webhookSecret)).toBe(false);
    expect(validWebhookToken("Bearer wrong", testConfig.webhookSecret)).toBe(false);
    expect(validWebhookToken(`Bearer ${testConfig.webhookSecret}`, testConfig.webhookSecret)).toBe(true);
  });
  it("separates workspace and campaign boundaries", () => {
    expect(() => normalizeInstantlyEvent(payload({ workspace: testConfig.campaignIds.materials_sales }), testConfig)).toThrow("Workspace not allowed");
    expect(normalizeInstantlyEvent(payload({ campaign_id: "44444444-4444-4444-8444-444444444444" }), testConfig)).toBeNull();
    const stop = normalizeInstantlyEvent(payload({ campaign_id: null, event_type: "lead_unsubscribed" }), testConfig)!;
    expect(stop.campaignKey).toBeNull(); expect(stop.suppress).toBe(true);
  });
  it("normalizes email and deduplicates provider retry metadata changes", () => {
    const first = normalizeInstantlyEvent(payload(), testConfig)!;
    const retry = normalizeInstantlyEvent(payload({ company_name: "Updated company", timestamp: "2026-09-09T20:00:03Z" }), testConfig)!;
    expect(first.email).toBe("person@example.com"); expect(first.dedupeKey).toBe(retry.dedupeKey);
    expect(normalizeInstantlyEvent(payload({ email_id: "message-2" }), testConfig)!.dedupeKey).not.toBe(first.dedupeKey);
  });
  it("preserves two interests for one contact without enrolling the second campaign", () => {
    const event = normalizeInstantlyEvent(payload({ reply_text: "I'd like to join the installer network. We also need a quote for a deck." }), testConfig)!;
    const plan = planOutreachEvent(event);
    expect(plan.tasks.map((task) => task.campaignKey)).toEqual(["installer_network", "materials_sales"]);
    expect(plan.intent).toBe("both_interests");
  });
  it("routes project requests independently of recruitment", () => {
    const event = normalizeInstantlyEvent(payload({ campaign_id: testConfig.campaignIds.materials_sales, reply_text: "Please quote the materials for our 40 foot deck." }), testConfig)!;
    expect(planOutreachEvent(event).tasks[0].kind).toBe("collect_quote_details");
  });
  it.each(["Please unsubscribe me.", "Thanks. Please remove us from your list.", "Don't contact me again."])("suppresses explicit opt-out: %s", (text) => {
    expect(explicitOptOut(text)).toBe(true);
    expect(planOutreachEvent(normalizeInstantlyEvent(payload({ reply_text: text }), testConfig)!).tasks).toEqual([]);
  });
  it("does not treat quoted history or a truncated preview as a new opt-out", () => {
    const text = "Please send the details.\nOn Tuesday, Someone wrote:\nPlease unsubscribe me.";
    expect(authoredText(text)).toBe("Please send the details."); expect(explicitOptOut(text)).toBe(false);
    const event = normalizeInstantlyEvent(payload({ reply_text: undefined, reply_text_snippet: "Please unsubscribe" }), testConfig)!;
    expect(event.suppress).toBe(false); expect(planOutreachEvent(event).intent).toBe("needs_review");
  });
  it.each(["I am not interested.", "No thanks."])("does not turn a decline into interest: %s", (text) => {
    const plan = planOutreachEvent(normalizeInstantlyEvent(payload({ reply_text: text }), testConfig)!);
    expect(plan.stage).toBe("declined"); expect(plan.tasks).toEqual([]);
  });
  it("sends mixed and ambiguous replies to review", () => {
    for (const text of ["Not interested in joining but need a quote.", "Don't send an installer application.", "Maybe. What does this cost?"]) {
      expect(planOutreachEvent(normalizeInstantlyEvent(payload({ reply_text: text }), testConfig)!).tasks[0].kind).toBe("review_reply");
    }
  });
  it("never marks an Instantly closed label as paid or approved", () => {
    const plan = planOutreachEvent(normalizeInstantlyEvent(payload({ event_type: "lead_closed" }), testConfig)!);
    expect(plan.intent).toBe("review_close"); expect(plan.tasks[0].kind).toBe("review_reply");
  });
  it("prepares separate draft campaigns without sending configuration", () => {
    expect(campaignDrafts.map((draft) => draft.key)).toEqual(["installer_network", "materials_sales"]);
    for (const draft of campaignDrafts) {
      expect(draft.status).toBe("draft"); expect(draft.stopOnReply).toBe(true);
      expect(draft.steps).toHaveLength(3); expect(JSON.stringify(draft)).not.toContain("\u2014");
    }
  });
});
