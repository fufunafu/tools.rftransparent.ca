import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { recordCronRunMock } = vi.hoisted(() => ({
  recordCronRunMock: vi.fn(),
}));

vi.mock("@/lib/cron-monitor", () => ({
  recordCronRun: recordCronRunMock,
}));

import {
  SKIP_RUN_HISTORY_HEADER,
  withCronRun,
} from "@/lib/automations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withCronRun", () => {
  it("does not record expected off-hour dispatcher checks", async () => {
    const handler = withCronRun("sync-calls", async () =>
      NextResponse.json(
        { skipped: true, reason: "Off schedule" },
        { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } },
      ),
    );

    const response = await handler(
      new NextRequest("https://tools.rftransparent.ca/api/cron/sync-calls"),
    );

    expect(response.status).toBe(200);
    expect(recordCronRunMock).not.toHaveBeenCalled();
  });

  it("continues recording real runs", async () => {
    const handler = withCronRun("sync-calls", async () =>
      NextResponse.json({ status: "success" }),
    );

    await handler(new NextRequest("https://tools.rftransparent.ca/api/cron/sync-calls"));

    expect(recordCronRunMock).toHaveBeenCalledWith(
      "sync-calls",
      "success",
      expect.any(String),
      expect.objectContaining({ startedAt: expect.any(Number) }),
    );
  });

  it("records actionable per-recipient errors from failed survey runs", async () => {
    const handler = withCronRun("send-employee-surveys", async () =>
      NextResponse.json(
        {
          error: "1 survey message(s) failed",
          errors: ["Alex (invalid WhatsApp phone): Enter an international number"],
        },
        { status: 502 },
      ),
    );

    await handler(
      new NextRequest("https://tools.rftransparent.ca/api/cron/send-employee-surveys"),
    );

    expect(recordCronRunMock).toHaveBeenCalledWith(
      "send-employee-surveys",
      "error",
      "1 survey message(s) failed: Alex (invalid WhatsApp phone): Enter an international number",
      expect.objectContaining({ startedAt: expect.any(Number) }),
    );
  });
});
