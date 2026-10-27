import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), send: vi.fn(), employee: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/resend", () => ({ getResend: () => ({ emails: { send: mocks.send } }) }));
vi.mock("@/lib/employee-profile", () => ({ findActiveEmployeeByEmail: mocks.employee }));
import { reminderMessage, sendCrmReminders, type CrmReminder } from "./reminders";

const reminder: CrmReminder = { id: "delivery-1", record_id: "tools:11111111-1111-4111-8111-111111111111", due_at: "2099-11-01T15:00:00Z", owner_email: "rep@example.com", kind: "upcoming", title: "Call customer", attempts: 1 };
function currentTask(data: unknown, error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data, error })) };
  mocks.from.mockReturnValue(query); return query;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("RESEND_API_KEY", "test-only");
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "crm_claim_reminders" ? [reminder] : true, error: null }));
  mocks.employee.mockResolvedValue({ department: "sales" });
  mocks.send.mockResolvedValue({ data: { id: "sent-1" }, error: null });
  currentTask({ id: reminder.record_id });
});
describe("CRM reminder delivery", () => {
  it("sends only to the task owner with a stable provider idempotency key and a task deep link", async () => {
    expect(await sendCrmReminders()).toEqual({ sent: 1, failed: 0 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: ["rep@example.com"], text: expect.stringContaining("hubspot-dupe?record=tools%3A11111111") }), { idempotencyKey: "crm-reminder/delivery-1" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_reminder", expect.objectContaining({ p_status: "sent", p_provider_id: "sent-1" }));
    expect(reminderMessage(reminder)).toEqual(reminderMessage(reminder));
  });
  it("does not send to inactive or unmapped owners", async () => {
    mocks.employee.mockResolvedValue(null);
    await sendCrmReminders();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_reminder", expect.objectContaining({ p_status: "cancelled", p_error: "owner_unavailable" }));
  });
  it("rechecks completion, reassignment and opt-out immediately before delivery", async () => {
    const query = currentTask(null);
    await sendCrmReminders();
    expect(query.eq).toHaveBeenCalledWith("reminder_enabled", true);
    expect(query.eq).toHaveBeenCalledWith("effective_task_status", "open");
    expect(query.eq).toHaveBeenCalledWith("owner_email", reminder.owner_email);
    expect(query.eq).toHaveBeenCalledWith("effective_due_at", reminder.due_at);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retains an uncertain delivery for retry with the same idempotency key", async () => {
    mocks.send.mockRejectedValueOnce(new Error("network interrupted"));
    expect(await sendCrmReminders()).toEqual({ sent: 0, failed: 1 });
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_finish_reminder", expect.objectContaining({ p_status: "pending", p_error: "delivery_unconfirmed" }));
    await sendCrmReminders();
    expect(mocks.send.mock.calls[0][1]).toEqual(mocks.send.mock.calls[1][1]);
  });
  it("does not consume the queue when email delivery is unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendCrmReminders()).toMatchObject({ sent: 0, skipped: expect.any(String) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
