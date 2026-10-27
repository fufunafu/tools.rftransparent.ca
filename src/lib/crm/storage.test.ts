import { describe, expect, it } from "vitest";
import { packHubspotRecord, packProperties, unpackProperties } from "./storage.mjs";

describe("lossless CRM history storage", () => {
  it("round-trips every property, including empty, null, HTML, Unicode and historic values", () => {
    const values = { name: "Montréal 客户", empty: "", unset: null, html: "<p>Important history</p>", history: [{ value: "Before", timestamp: "2024-01-01" }, { value: "After" }] };
    expect(unpackProperties(packProperties(values))).toEqual(values);
  });
  it("opens existing uncompressed and Tools-native records unchanged", () => {
    const value = { email: "test@example.com", data: "not an envelope" };
    expect(unpackProperties(value)).toEqual(value);
  });
  it("keeps searchable fields intact and stores the original data once", () => {
    const record = { title: "Follow up", body: "Meeting notes", properties: { custom: "preserved" }, property_history: { custom: [{ value: "earlier" }] }, raw: { duplicate: true } };
    const stored = packHubspotRecord(record);
    expect(stored.title).toBe("Follow up");
    expect(stored.body).toBe("Meeting notes");
    expect(stored).not.toHaveProperty("raw");
    expect(unpackProperties(stored.properties)).toEqual(record.properties);
    expect(unpackProperties(stored.property_history)).toEqual(record.property_history);
  });
  it("rejects corrupt compressed data instead of displaying incomplete history", () => {
    expect(() => unpackProperties({ __rf_crm_gzip_base64_v1__: "invalid" })).toThrow();
  });
});
