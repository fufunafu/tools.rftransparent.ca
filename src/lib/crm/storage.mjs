// Server and migration CLI only. Keep full source values/history with lossless
// compression; normalized searchable fields remain regular database columns.
import { gzipSync, gunzipSync } from "node:zlib";
const ENVELOPE = "__rf_crm_gzip_base64_v1__";

export function packProperties(value) {
  return { [ENVELOPE]: gzipSync(JSON.stringify(value)).toString("base64") };
}

export function unpackProperties(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || typeof value[ENVELOPE] !== "string") return value;
  return JSON.parse(gunzipSync(Buffer.from(value[ENVELOPE], "base64"), { maxOutputLength: 64_000_000 }).toString("utf8"));
}

export function packHubspotRecord(record) {
  const copy = { ...record, properties: packProperties(record.properties), property_history: packProperties(record.property_history) };
  delete copy.raw;
  return copy;
}
