import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { captureContent, captureCrmActivity, captureIdentity, type CaptureEvent } from "./capture";

const email: CaptureEvent = { id: "event-1", kind: "emails", revision: 1, source_key: "gmail:shared:m1", occurred_at: "2026-10-27T18:00:00Z", record_id: null, contact_id: null,
  payload: { inbox: "info@glass-railing.com", direction: "inbound", from_email: "Client@example.com", to_email: "info@glass-railing.com", subject: "Project", snippet: "Please call" } };
const call: CaptureEvent = { ...email, kind: "calls", payload: { store_id: "rf_transparent", source: "cik", direction: "inbound", from_number: "416-555-0199", to_number: "+19055550199", duration_min: 3, endpoint: "Desk 1" } };
let matches: string[]; let employees: object[]; let otherCalls: object[];
function result(data: unknown) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
  return query;
}
beforeEach(() => {
  vi.resetAllMocks(); matches = ["tools:customer-1"]; employees = []; otherCalls = [];
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "crm_claim_capture" ? [email] : "tools:activity", error: null }));
  mocks.from.mockImplementation((table: string) => result(table === "employees" ? employees : table === "crm_identities" ? matches.map(record_id => ({ record_id })) : otherCalls));
});
describe("automatic CRM activity", () => {
  it("captures an exact customer match once without inventing a staff author or full email body", async () => {
    expect(await captureCrmActivity()).toEqual({ captured: 1, ignored: 0, review: 0 });
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_capture", expect.objectContaining({ p_result: expect.objectContaining({ contact_id: "tools:customer-1", status: "captured", body: expect.stringContaining("This is a preview") }) }));
    expect(captureContent(call).body).toContain("does not identify a verified staff member");
  });
  it("holds ambiguous and unmatched identities for staff review", async () => {
    matches = ["tools:a", "tools:b"];
    expect(await captureCrmActivity()).toEqual({ captured: 0, ignored: 0, review: 1 });
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_capture", expect.objectContaining({ p_result: expect.objectContaining({ reason: "ambiguous_identity", contact_id: null }) }));
    matches = [];
    await captureCrmActivity();
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_capture", expect.objectContaining({ p_result: expect.objectContaining({ reason: "no_customer_match" }) }));
  });
  it("excludes employee mail, even when the address is also an imported contact", async () => {
    employees = [{ email: "client@example.com", email_alt: null }];
    expect(await captureCrmActivity()).toEqual({ captured: 0, ignored: 1, review: 0 });
    expect(mocks.from).not.toHaveBeenCalledWith("crm_identities");
  });
  it("recognizes forwarded CIK legs across number formatting and keeps independent stores separate", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "crm_claim_capture" ? [call] : null }));
    otherCalls = [{ record_id: null, payload: { ...call.payload, source: "grasshopper", from_number: "+1 (416) 555-0199" } }];
    expect(await captureCrmActivity()).toEqual({ captured: 0, ignored: 1, review: 0 });
    otherCalls = [{ record_id: null, payload: { ...call.payload, source: "grasshopper", store_id: "bc_transparent" } }];
    expect(await captureCrmActivity()).toEqual({ captured: 1, ignored: 0, review: 0 });
  });
  it("does not silently move an existing activity to a different customer", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "crm_claim_capture" ? [{ ...email, contact_id: "tools:previous" }] : null }));
    expect(await captureCrmActivity()).toEqual({ captured: 0, ignored: 0, review: 1 });
  });
  it("uses the external party for inbound and outbound email/calls", () => {
    expect(captureIdentity(email)).toEqual({ kind: "email", value: "client@example.com" });
    expect(captureIdentity({ ...email, payload: { ...email.payload, direction: "outbound", from_email: "info@glass-railing.com", to_email: "client@example.com" } })).toEqual({ kind: "email", value: "client@example.com" });
    expect(captureIdentity(call)).toEqual({ kind: "phone", value: "+14165550199" });
    expect(captureIdentity({ ...call, payload: { ...call.payload, direction: "outbound" } })).toEqual({ kind: "phone", value: "+19055550199" });
  });
});
