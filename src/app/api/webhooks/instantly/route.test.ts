import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const ingest = vi.hoisted(() => vi.fn());
const immediate = vi.hoisted(() => vi.fn());
const scheduled = vi.hoisted(() => vi.fn());
vi.mock('next/server',async(importOriginal)=>({...await importOriginal<typeof import('next/server')>(),after:scheduled}));
vi.mock("@/lib/outreach/service", () => ({ ingestOutreachEvent: ingest, processImmediateOutreachEvent: immediate }));
import { POST } from "./route";

const secret = "local-test-secret-that-is-at-least-32-characters";
const workspace = "11111111-1111-4111-8111-111111111111";
const installer = "22222222-2222-4222-8222-222222222222";
function request(body: unknown, token = `Bearer ${secret}`) {
  return new Request("https://tools.example.com/api/webhooks/instantly", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token }, body: JSON.stringify(body) });
}
const event = { workspace, campaign_id: installer, timestamp: "2026-09-09T20:00:00Z", event_type: "reply_received", lead_email: "test@example.com", reply_text: "Please send an installer application." };
beforeEach(() => {
  scheduled.mockReset();immediate.mockReset().mockResolvedValue({claimed:1});vi.stubEnv('OUTREACH_WORKER_ENABLED','true');
  vi.stubEnv("OUTREACH_INSTANTLY_WORKSPACE_ID", workspace); vi.stubEnv("OUTREACH_INSTALLER_CAMPAIGN_ID", installer);
  vi.stubEnv("OUTREACH_MATERIALS_CAMPAIGN_ID", "33333333-3333-4333-8333-333333333333"); vi.stubEnv("OUTREACH_WEBHOOK_SECRET", secret);
  ingest.mockReset().mockResolvedValue({ duplicate: false, id: "test-event" });
});
afterEach(() => vi.unstubAllEnvs());

describe("Instantly webhook route", () => {
  it("rejects unauthenticated deliveries before touching storage", async () => {
    expect((await POST(request(event, "Bearer wrong"))).status).toBe(401); expect(ingest).not.toHaveBeenCalled();
  });
  it("fails closed when configuration is incomplete", async () => {
    vi.stubEnv("OUTREACH_WEBHOOK_SECRET", ""); expect((await POST(request(event))).status).toBe(503); expect(ingest).not.toHaveBeenCalled();
  });
  it("rejects a different workspace", async () => {
    expect((await POST(request({ ...event, workspace: installer }))).status).toBe(403); expect(ingest).not.toHaveBeenCalled();
  });
  it("acknowledges unsupported events without storing them", async () => {
    const response = await POST(request({ ...event, event_type: "email_opened" })); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true }); expect(ingest).not.toHaveBeenCalled();
  });
  it("acknowledges committed events and duplicates", async () => {
    expect((await POST(request(event))).status).toBe(200); expect(ingest).toHaveBeenCalledTimes(1);
    ingest.mockResolvedValueOnce({ duplicate: true });
    expect(await (await POST(request(event))).json()).toEqual({ received: true, duplicate: true });
  });
  it("returns retryable failure if storage fails", async () => {
    ingest.mockRejectedValue(new Error("private database information")); const response = await POST(request(event));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
  it("rejects malformed or oversized JSON", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ ...event, reply_text: "a".repeat(300_000) }))).status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("enforces the streaming size limit even without content-length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("a".repeat(270_000))); controller.close(); } });
    const streamed = new Request("https://tools.example.com/api/webhooks/instantly", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: stream, duplex: "half" } as RequestInit);
    expect((await POST(streamed)).status).toBe(413); expect(ingest).not.toHaveBeenCalled();
  });
});

it('schedules committed interest immediately but leaves expensive replies in the worker budget',async()=>{
 await POST(request({...event,event_type:'lead_interested'}));
 expect(scheduled).toHaveBeenCalledTimes(1);
 await scheduled.mock.calls[0][0]();expect(immediate).toHaveBeenCalledWith('test-event');
 scheduled.mockClear();await POST(request(event));expect(scheduled).not.toHaveBeenCalled();
});
it('keeps the committed event for cron if immediate processing fails, and honors the worker switch',async()=>{
 immediate.mockRejectedValue(new Error('temporary'));
 await POST(request({...event,event_type:'lead_interested'}));
 await expect(scheduled.mock.calls[0][0]()).resolves.toBeUndefined();
 scheduled.mockClear();vi.stubEnv('OUTREACH_WORKER_ENABLED','false');
 await POST(request({...event,event_type:'lead_interested'}));expect(scheduled).not.toHaveBeenCalled();
});
