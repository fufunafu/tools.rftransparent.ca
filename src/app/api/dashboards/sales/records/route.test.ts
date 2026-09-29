import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSalesRepRecords } from "@/lib/dashboard-sales-records";
vi.mock("@/lib/admin-auth", () => ({ isAuthenticated: vi.fn() }));
vi.mock("@/lib/dashboard-sales-records", () => ({ getSalesRepRecords: vi.fn() }));
beforeEach(() => { vi.mocked(isAuthenticated).mockResolvedValue(true); vi.mocked(getSalesRepRecords).mockReset(); });
it("requires authentication before reading order data", async () => {
  vi.mocked(isAuthenticated).mockResolvedValue(false);
  expect((await GET(new NextRequest("https://example.test/api/dashboards/sales/records?repId=rob&period=7d&kind=orders"))).status).toBe(401);
  expect(getSalesRepRecords).not.toHaveBeenCalled();
});
it("validates the selected period and record type", async () => {
  expect((await GET(new NextRequest("https://example.test/api/dashboards/sales/records?repId=rob&period=all&kind=orders"))).status).toBe(400);
  expect(getSalesRepRecords).not.toHaveBeenCalled();
});
it("returns the selected rep and period's records", async () => {
  vi.mocked(getSalesRepRecords).mockResolvedValue({ records: [], total: 0, warnings: [] });
  const response = await GET(new NextRequest("https://example.test/api/dashboards/sales/records?repId=rob&period=7d&kind=quotes"));
  expect(response.status).toBe(200);
  expect(getSalesRepRecords).toHaveBeenCalledWith("rob", "7d", "quotes");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
