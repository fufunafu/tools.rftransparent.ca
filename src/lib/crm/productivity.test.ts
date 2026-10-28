import { describe, expect, it } from "vitest";
import { activityChips, canDelete, canEditActivity, databaseError, detailsFor } from "./productivity";
import { reportRange } from "./report";

describe("CRM productivity rules", () => {
  it("keeps only details that belong to the record type", () => {
    expect(detailsFor("calls", { call_outcome: "voicemail", priority: "high", duration_minutes: "" })).toEqual({ call_outcome: "voicemail" });
    expect(detailsFor("tasks", { priority: "high", task_type: "call", call_outcome: "busy" })).toEqual({ priority: "high", task_type: "call" });
    expect(detailsFor("notes", { call_outcome: "busy" })).toEqual({});
  });
  it("labels timeline chips from Tools details", () => {
    expect(activityChips({ object_type: "calls", local_fields: { call_direction: "outbound", call_outcome: "no_answer", duration_minutes: "4" } })).toEqual(["Outbound", "No answer", "4 min"]);
    expect(activityChips({ object_type: "tasks", local_fields: { priority: "high", task_type: "email" } })).toEqual(["Email", "High priority"]);
    expect(activityChips({ object_type: "notes", local_fields: { call_outcome: "busy" } })).toEqual([]);
  });
  it("lets creators manage their own Tools records and management manage everything", () => {
    const tools = { source: "tools" as const, created_by_email: "rep@example.com", object_type: "notes" as const, archived: false };
    expect(canDelete(tools, "rep@example.com", false)).toBe(true);
    expect(canDelete(tools, "other@example.com", false)).toBe(false);
    expect(canDelete({ ...tools, source: "hubspot" }, "rep@example.com", false)).toBe(false);
    expect(canDelete({ ...tools, source: "hubspot" }, "boss@example.com", true)).toBe(true);
    expect(canDelete({ ...tools, object_type: "deals" }, "boss@example.com", true)).toBe(false);
    expect(canEditActivity({ ...tools, source: "hubspot" }, "boss@example.com", true)).toBe(false);
    expect(canEditActivity({ ...tools, archived: true }, "rep@example.com", false)).toBe(false);
  });
  it("maps database errors without exposing internals", () => {
    expect(databaseError({ message: "ERROR: Imported activity is read-only" }, "fallback")).toEqual({ message: "Imported activity is read-only", status: 409 });
    expect(databaseError({ message: "Only the author or management may edit this activity" }, "fallback").status).toBe(403);
    expect(databaseError({ message: "duplicate key value violates crm_internal" }, "fallback")).toEqual({ message: "fallback", status: 409 });
    expect(databaseError({ code: "PGRST202" }, "fallback").status).toBe(503);
  });
});

describe("report periods", () => {
  // Wednesday 2026-10-28 15:00 in Toronto (19:00 UTC, daylight time).
  const now = new Date("2026-10-28T19:00:00Z");
  it("starts weeks on Monday and months on the 1st in the viewer's zone", () => {
    expect(reportRange("this_week", now, "America/Toronto")).toEqual({ start: "2026-10-26T04:00:00.000Z", end: "2026-10-29T04:00:00.000Z" });
    expect(reportRange("last_week", now, "America/Toronto")).toEqual({ start: "2026-10-19T04:00:00.000Z", end: "2026-10-26T04:00:00.000Z" });
    expect(reportRange("this_month", now, "America/Toronto").start).toBe("2026-10-01T04:00:00.000Z");
    expect(reportRange("last_month", now, "America/Toronto")).toEqual({ start: "2026-09-01T04:00:00.000Z", end: "2026-10-01T04:00:00.000Z" });
  });
  it("handles the standard-time change inside a period", () => {
    // November 2026 ends daylight time on the 1st.
    expect(reportRange("last_month", new Date("2026-12-10T17:00:00Z"), "America/Toronto")).toEqual({ start: "2026-11-01T04:00:00.000Z", end: "2026-12-01T05:00:00.000Z" });
  });
});
