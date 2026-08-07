import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  alertOnSoftFailuresMock,
  fetchMock,
  syncLeadCallStatusesMock,
} = vi.hoisted(() => ({
  alertOnSoftFailuresMock: vi.fn(),
  fetchMock: vi.fn(),
  syncLeadCallStatusesMock: vi.fn(),
}));

vi.mock("@/lib/automations", () => ({
  SKIP_RUN_HISTORY_HEADER: "x-skip-run-history",
  TRIGGERED_BY_HEADER: "x-triggered-by",
  withCronRun: (_job: string, handler: (request: NextRequest) => Promise<Response>) => handler,
}));

vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCronRequest: () => true }));
vi.mock("@/lib/cron-monitor", () => ({ alertOnSoftFailures: alertOnSoftFailuresMock }));
vi.mock("@/lib/lead-call-sync", () => ({ syncLeadCallStatuses: syncLeadCallStatusesMock }));
vi.mock("@/lib/supabase", () => ({ getSupabase: vi.fn() }));

import { GET } from "@/app/api/cron/sync-calls/route";

function manualRequest() {
  return new NextRequest("https://tools.rftransparent.ca/api/cron/sync-calls", {
    headers: { "x-triggered-by": "admin@example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SCRAPER_URL", "https://scraper.example.com");
  vi.stubEnv("SCRAPER_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  syncLeadCallStatusesMock.mockResolvedValue({
    called: 2,
    noAnswer: 1,
    phonesRecovered: 0,
  });
});

describe("GET /api/cron/sync-calls", () => {
  it("starts both CIK imports and Grasshopper concurrently", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));

    const responsePromise = GET(manualRequest());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://scraper.example.com/scrape?store=bc_transparent",
      "https://scraper.example.com/scrape?store=rf_transparent",
      "https://scraper.example.com/scrape-grasshopper",
    ]);

    for (const resolve of resolvers) {
      resolve(new Response(JSON.stringify({ status: "success", records_inserted: 4 })));
    }

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(syncLeadCallStatusesMock).toHaveBeenCalledOnce();
  });

  it("returns an actionable soft failure for a non-JSON provider response", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("Gateway timeout", { status: 504 })));

    const response = await GET(manualRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(4);
    expect(body.results[0]).toMatchObject({ status: "error", detail: "HTTP 504" });
    expect(alertOnSoftFailuresMock).toHaveBeenCalledOnce();
  });
});
