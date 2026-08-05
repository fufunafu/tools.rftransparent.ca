import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/resend", () => ({
  getResend: () => ({
    emails: {
      send: sendEmailMock,
    },
  }),
}));

import {
  LEAD_NOTIFICATION_RECIPIENT,
  sendNewLeadNotification,
} from "@/lib/lead-notifications";

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("sendNewLeadNotification", () => {
  it("sends new lead details to the sales inbox", async () => {
    const sent = await sendNewLeadNotification({
      leadId: "lead-123",
      source: "meta",
      sourceDetail: "Summer railing campaign",
      pageUrl: null,
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "514-555-1234",
      message: "I need a quote.",
      installationRequested: true,
    });

    expect(sent).toBe(true);
    expect(LEAD_NOTIFICATION_RECIPIENT).toBe("info@glass-railing.com");
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "RF Transparent <info@glass-railing.com>",
        to: "info@glass-railing.com",
        subject: "New Meta lead: Jane Doe",
        text: expect.stringContaining("Email: jane@example.com"),
        html: expect.stringContaining("Installation</td><td style=\"padding:5px 0\">Requested"),
      }),
    );
  });

  it("escapes customer-controlled content in the HTML email", async () => {
    await sendNewLeadNotification({
      leadId: "lead-456",
      source: "website",
      sourceDetail: null,
      pageUrl: null,
      name: "<script>alert(1)</script>",
      email: "jane@example.com",
      phone: null,
      message: "<img src=x onerror=alert(1)>",
      installationRequested: null,
    });

    const payload = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(payload.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).not.toContain("<img src=x");
  });

  it("returns false instead of throwing when Resend rejects the email", async () => {
    sendEmailMock.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendNewLeadNotification({
        leadId: "lead-789",
        source: "website",
        sourceDetail: null,
        pageUrl: null,
        name: null,
        email: "jane@example.com",
        phone: null,
        message: null,
        installationRequested: null,
      }),
    ).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
