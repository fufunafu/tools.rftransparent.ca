import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: sendMock } }),
}));
vi.mock("@/lib/authz", () => ({ OWNER_EMAIL: "owner@example.com" }));

import { reportCronFailure, alertOnSoftFailures } from "@/lib/cron-monitor";

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ id: "email_1" });
});

describe("reportCronFailure", () => {
  it("sends an alert email with the job name in the subject", async () => {
    await reportCronFailure("sync-calls", "boom");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain("sync-calls");
    expect(arg.to).toBe("owner@example.com");
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
