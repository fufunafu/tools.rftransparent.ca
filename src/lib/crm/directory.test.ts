import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));
import { getCrmDirectoryOptions, readDirectoryFilters } from "./directory-data";
import { appendDirectoryFilters, emptyDirectoryFilters } from "./directory";
import { projectCrmLocation } from "./location.mjs";
beforeEach(() => vi.resetAllMocks());
it("round-trips multiple filters and missing values without changing the default preload URL", () => {
  const params = new URLSearchParams("type=contacts");
  appendDirectoryFilters(params, emptyDirectoryFilters(), "newest", "");
  expect(params.toString()).toBe("type=contacts");
  appendDirectoryFilters(params, { ...emptyDirectoryFilters(), owner: ["REP@example.com", ""], city: ["Montréal", 'Name, with "quotes"'] }, "name_asc", "hubspot");
  expect(readDirectoryFilters(params)).toEqual({ filters: { ...emptyDirectoryFilters(), owner: ["rep@example.com", ""], city: ["montréal", 'name, with "quotes"'] }, sort: "name_asc", source: "hubspot" });
});
it("rejects excessive, malformed, and unsupported filters", () => {
  for (const query of ["sort=properties", "source=unknown", "city=bad%0Avalue", `stage=${"a".repeat(501)}`, Array.from({ length: 21 }, () => "owner=a").join("&")]) expect(() => readDirectoryFilters(new URLSearchParams(query))).toThrow();
});
it("normalizes explicit country names and keeps missing and ambiguous location data honest", () => {
  expect(projectCrmLocation({ country: " ca ", city: " Toronto  ", state: "ON" })).toEqual({ country: "Canada", region: "Ontario", city: "Toronto" });
  expect(projectCrmLocation({ country: "USA", hs_state_code: "CA" })).toEqual({ country: "United States", region: "California", city: "" });
  expect(projectCrmLocation({ city: "London", state: "Ontario" })).toEqual({ country: "", region: "Ontario", city: "London" });
  expect(projectCrmLocation({ country: "America (west)" }).country).toBe("America (west)");
});
it("reads options for the requested directory and archive scope, surfacing database failures", async () => {
  rpc.mockResolvedValue({ data: { owner: [] } });
  expect(await getCrmDirectoryOptions(new URLSearchParams("type=companies&archived=true"))).toEqual({ owner: [] });
  expect(rpc).toHaveBeenCalledWith("crm_directory_filter_options", { p_type: "companies", p_archived: true });
  rpc.mockResolvedValue({ error: { message: "private diagnostic" } });
  await expect(getCrmDirectoryOptions(new URLSearchParams("type=contacts"))).rejects.toThrow("CRM filters are unavailable");
  await expect(getCrmDirectoryOptions(new URLSearchParams("type=emails"))).rejects.toThrow("Choose Contacts or Companies");
});
