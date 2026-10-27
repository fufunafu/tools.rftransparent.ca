import { describe, expect, it, vi } from "vitest";
import { HubspotError, hubspotClient, normalizeHubspotRecord, readHubspotPage, textFromHtml } from "./hubspot.mjs";

describe("HubSpot import", () => {
  it("records unsupported archives explicitly and never hides other access failures", async () => {
    const options = { portalId: "1", type: "meetings", properties: [], owners: {}, after: null, archived: true };
    const request = vi.fn().mockRejectedValueOnce(new HubspotError(400, "ARCHIVE_NOT_SUPPORTED")).mockRejectedValueOnce(new HubspotError(403));
    const page = await readHubspotPage(request, options);
    expect(page.unavailable).toContain("archived meetings");
    expect(page.after).toBeNull();
    await expect(readHubspotPage(request, options)).rejects.toThrow("403");
  });
  it("uses only the fixed API origin, retries rate limits, and does not leak response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("rate limit", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(Response.json({ results: [] })).mockResolvedValueOnce(new Response("private contact information", { status: 403 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = hubspotClient("secret", fetcher, sleep);
    await expect(request("/crm/v3/objects/contacts")).resolves.toEqual({ results: [] });
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    await expect(request("/crm/v3/objects/contacts")).rejects.toThrow("HubSpot request failed (403");
    await expect(request("https://evil.example/")).rejects.toThrow("Unsupported");
  });

  it("fetches every property history and follows association pagination without trusting next URLs", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      results: [{ id: "5", associations: { contacts: { results: [{ id: "8", type: "email_to_contact" }], paging: { next: { after: "next", link: "https://evil.example" } } } } }],
      paging: { next: { after: "101" } },
    }).mockResolvedValueOnce({ results: [{ id: "5", properties: { hs_email_subject: "Hello", custom_field: "keep" }, propertiesWithHistory: { custom_field: [{ value: "before" }] } }] })
      .mockResolvedValueOnce({ results: [{ id: "9", type: "email_to_contact" }] });
    const page = await readHubspotPage(request, { portalId: "40088916", type: "emails", properties: ["hs_email_subject", "custom_field"], owners: {}, after: null, archived: false });
    expect(request.mock.calls[1][1].propertiesWithHistory).toEqual(["hs_email_subject", "custom_field"]);
    expect(request.mock.calls[2][0]).toBe("/crm/v3/objects/emails/5/associations/contacts?limit=500&after=next");
    expect(page.links).toHaveLength(2);
    expect(page.records[0].property_history.custom_field).toEqual([{ value: "before" }]);
    expect(page.after).toBe("101");
  });

  it("fails incomplete batches so missing records cannot be silently skipped", async () => {
    const request = vi.fn().mockResolvedValueOnce({ results: [{ id: "1" }, { id: "2" }] }).mockResolvedValueOnce({ results: [{ id: "1" }] });
    await expect(readHubspotPage(request, { portalId: "1", type: "contacts", properties: [], owners: {}, after: null, archived: false })).rejects.toThrow("incomplete");
  });

  it("preserves source records, task times, owner attribution and archive status", () => {
    const raw = { id: "7", archived: true, properties: { hs_task_subject: "Call back", hs_timestamp: "1793145600000", hs_task_status: "COMPLETED", hubspot_owner_id: "4", custom: "keep" } };
    const record = normalizeHubspotRecord("40088916", "tasks", raw, { "4": { email: "Rep@Example.com" } });
    expect(record).toMatchObject({ source: "hubspot", archived: true, owner_email: "rep@example.com", task_status: "completed", raw });
    expect(record.due_at).toBe(new Date(1793145600000).toISOString());
    expect(record.properties.custom).toBe("keep");
    expect(textFromHtml('<p>Notes &amp; history</p><script>alert(1)</script>')).toBe("Notes & history");
  });
});
