import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { authorizedMock, dispatchHourMock, runMock, reportFailureMock } = vi.hoisted(() => ({
  authorizedMock: vi.fn(),
  dispatchHourMock: vi.fn(),
  runMock: vi.fn(),
  reportFailureMock: vi.fn(),
}));

vi.mock("@/lib/automations", () => ({
  SKIP_RUN_HISTORY_HEADER: "x-skip-run-history",
  TRIGGERED_BY_HEADER: "x-triggered-by",
  withCronRun: (_job: string, handler: (request: NextRequest) => Promise<NextResponse>) => handler,
}));
vi.mock("@/lib/birthday-automation", () => ({
  isBirthdayDispatchHour: dispatchHourMock,
  runBirthdayAutomation: runMock,
}));
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCronRequest: authorizedMock }));
vi.mock("@/lib/cron-monitor", () => ({ reportCronFailure: reportFailureMock }));

import { GET } from "@/app/api/cron/birthday-messages/route";

const successResult = {
  status: "success",
  celebrationDate: "2026-08-14",
  birthdayEmployees: 1,
  greetingsSent: 1,
  remindersSent: 2,
  skipped: 0,
  failed: 0,
  errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizedMock.mockReturnValue(true);
  dispatchHourMock.mockReturnValue(false);
  runMock.mockResolvedValue(successResult);
});

describe("birthday message cron", () => {
  it("skips off-hour scheduler checks without recording run history", async () => {
    const response = await GET(new NextRequest("https://tools.example/api/cron/birthday-messages"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-skip-run-history")).toBe("true");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("allows a confirmed manual run outside the scheduled hour", async () => {
    const response = await GET(new NextRequest("https://tools.example/api/cron/birthday-messages", {
      headers: { "x-triggered-by": "manager@example.com" },
    }));
    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledOnce();
  });

  it("runs automatically during the Toronto dispatch hour", async () => {
    dispatchHourMock.mockReturnValue(true);
    const response = await GET(new NextRequest("https://tools.example/api/cron/birthday-messages"));
    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledOnce();
  });
});
