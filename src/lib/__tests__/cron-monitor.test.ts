import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
const notificationsMock = vi.fn();
const insertMock = vi.fn();
const supabaseMock = vi.fn();

vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: sendMock } }),
}));
vi.mock("@/lib/authz", () => ({ OWNER_EMAIL: "owner@example.com" }));
vi.mock("@/lib/settings", () => ({
  getNotificationSettings: () => notificationsMock(),
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => supabaseMock(),
}));

import { reportCronFailure, alertOnSoftFailures, recordCronRun } from "@/lib/cron-monitor";

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "email_1" });
  notificationsMock.mockReset();
  notificationsMock.mockResolvedValue({
    cron_alerts: ["owner@example.com"],
    problems_digest: [],
    followup_by_store: {},
  });
  insertMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
  supabaseMock.mockReset();
  supabaseMock.mockReturnValue({ from: () => ({ insert: insertMock }) });
});

describe("reportCronFailure", () => {
  it("sends an alert email with the job name in the subject", async () => {
    await reportCronFailure("sync-calls", "boom");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain("sync-calls");
    expect(arg.to).toEqual(["owner@example.com"]);
  });

  it("sends to whoever the notification settings name", async () => {
    notificationsMock.mockResolvedValue({
      cron_alerts: ["ops@example.com", "second@example.com"],
      problems_digest: [],
      followup_by_store: {},
    });
    await reportCronFailure("sync-calls", "boom");
    expect(sendMock.mock.calls[0][0].to).toEqual(["ops@example.com", "second@example.com"]);
  });

  it("escapes HTML in the detail so it can't break the email markup", async () => {
    await reportCronFailure("job", "<script>alert(1)</script>");
    const arg = sendMock.mock.calls[0][0];
    expect(arg.html).toContain("&lt;script&gt;");
    expect(arg.html).not.toContain("<script>");
  });

  it("never throws when the alert email itself fails", async () => {
    sendMock.mockRejectedValueOnce(new Error("resend down"));
    await expect(reportCronFailure("job", "detail")).resolves.toBeUndefined();
  });

  it("never throws when the recipient lookup fails", async () => {
    notificationsMock.mockRejectedValueOnce(new Error("db down"));
    await expect(reportCronFailure("job", "detail")).resolves.toBeUndefined();
  });
});

describe("alertOnSoftFailures", () => {
  it("does not send when every item succeeded", async () => {
    const n = await alertOnSoftFailures("sync-followup", [
      { status: "ok" },
      { status: "sent" },
    ]);
    expect(n).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends one summary alert and returns the failure count", async () => {
    const n = await alertOnSoftFailures("sync-followup", [
      { status: "ok" },
      { status: "error", store_id: "store1", detail: "timeout" },
      { status: "error", store_id: "store2", detail: "500" },
    ]);
    expect(n).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].html).toContain("2/3");
  });
});

describe("recordCronRun", () => {
  it("writes the job, status and detail", async () => {
    await recordCronRun("sync-calls", "success", "42 calls");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.job).toBe("sync-calls");
    expect(row.status).toBe("success");
    expect(row.detail).toBe("42 calls");
  });

  it("truncates very long details", async () => {
    await recordCronRun("job", "error", "x".repeat(5000));
    expect(insertMock.mock.calls[0][0].detail).toHaveLength(2000);
  });

  it("never throws when the table is missing", async () => {
    supabaseMock.mockImplementation(() => {
      throw new Error('relation "cron_runs" does not exist');
    });
    await expect(recordCronRun("job", "success", "detail")).resolves.toBeUndefined();
  });
});
