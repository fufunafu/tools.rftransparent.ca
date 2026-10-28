import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, projectCrmRecord } from "./identity.mjs";
import { packProperties } from "./storage.mjs";

describe("CRM matching identities", () => {
  it("normalizes exact emails while retaining aliases and rejecting recipient lists", () => {
    expect(normalizeEmail(" Client+shop@Example.COM ")).toBe("client+shop@example.com");
    expect(normalizeEmail("one@example.com, two@example.com")).toBeNull();
    expect(normalizeEmail("Someone <one@example.com>")).toBeNull();
  });
  it("matches North American formatting and rejects ambiguous international numbers and extensions", () => {
    expect(normalizePhone("(416) 555-0199 ext 23")).toBe("+14165550199");
    expect(normalizePhone("+1 416-555-0199")).toBe("+14165550199");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+46 91234567")).toBe("+4691234567");
    expect(normalizePhone("020 7946 0958")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("4165550199 or 9055550199")).toBeNull();
  });
  it("projects compressed fields losslessly and excludes archived contacts from matches", () => {
    const original = { email: "client@example.com", hs_additional_emails: "other@example.com", phone: "+14165550199", custom: { retained: true } };
    const properties = packProperties(original);
    const record = { object_type: "contacts", source: "hubspot", portal_id: "1", archived: false, properties };
    const result = projectCrmRecord(record);
    expect(result.identities).toHaveLength(3);
    expect(record.properties).toEqual(properties);
    expect(projectCrmRecord({ ...record, archived: true }).identities).toEqual([]);
  });
  it("keeps location in compact display fields without copying the source blob", () => {
    const properties = packProperties({ country: "CA", state: "Ontario", city: "Toronto", private_source_field: "retained" });
    const result = projectCrmRecord({ object_type: "companies", properties });
    expect(result.view_fields).toMatchObject({ country: "Canada", region: "Ontario", city: "Toronto" });
    expect(result.view_fields).not.toHaveProperty("private_source_field");
  });
  it("deduplicates attachment references but retains distinct recording URLs for review", () => {
    const result = projectCrmRecord({ object_type: "calls", source: "hubspot", portal_id: "1", properties: { hs_attachment_ids: "1;2;1;bad", hs_call_recording_url: "https://unverified.example/recording" } });
    expect(result.assets).toHaveLength(3);
    expect(result.assets[0]).toMatchObject({ id: "hubspot:1:file:1", remote_id: "1" });
    expect(result.assets[2]).toMatchObject({ kind: "recording", source_url: "https://unverified.example/recording" });
  });
});
