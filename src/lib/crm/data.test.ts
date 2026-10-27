import { beforeEach, expect, it, vi } from "vitest";
import { packProperties } from "./storage.mjs";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: mock.from }) }));
import { getCrmRecord } from "./data";

const originalFields = { email: "client@example.com", project: "Keep all source fields" };
const originalHistory = { project: [{ value: "Previous project", timestamp: "2026-10-01" }] };
const row = { id: "hubspot:1:contacts:2", title: "Customer", body: "Conversation", properties: packProperties(originalFields), property_history: packProperties(originalHistory) };
beforeEach(() => {
  vi.resetAllMocks();
  mock.from.mockReturnValue(mock); mock.select.mockReturnValue(mock); mock.eq.mockReturnValue(mock);
  mock.maybeSingle.mockImplementation(async () => {
    const columns = String(mock.select.mock.calls.at(-1)?.[0]).split(",");
    return { data: Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key))), error: null };
  });
});
it("does not read or decompress source blobs for the normal record detail", async () => {
  const record = await getCrmRecord(row.id, "detail");
  expect(record).toEqual({ id: row.id, title: row.title, body: row.body });
  expect(mock.select.mock.calls[0][0]).not.toMatch(/properties|property_history/);
});
it.each(["fields", "history"] as const)("loads only the requested %s source blob without losing any values", async view => {
  const record = await getCrmRecord(row.id, view);
  expect(record.body).toBeUndefined();
  expect(record.properties).toEqual(view === "fields" ? originalFields : undefined);
  expect(record.property_history).toEqual(view === "history" ? originalHistory : undefined);
});
it("keeps the existing full-record API lossless", async () => {
  expect(await getCrmRecord(row.id)).toEqual({ ...row, properties: originalFields, property_history: originalHistory });
});
it("uses a small read for task authorization and related-record existence checks", async () => {
  expect(await getCrmRecord(row.id, "summary")).toEqual({ id: row.id, title: row.title });
  expect(mock.select.mock.calls[0][0]).not.toMatch(/body|properties|property_history/);
});
