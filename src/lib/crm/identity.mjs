import { createHash } from "node:crypto";
import { unpackProperties } from "./storage.mjs";
import { projectCrmImages } from "./record-images.mjs";
import { projectCrmLocation } from "./location.mjs";

// Keep exact mailbox identity. Do not remove dots or plus tags, which can
// identify different customers outside providers with special alias rules.
export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ? email : null;
}

export function normalizePhone(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim().replace(/(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "");
  if (/[^+\d\s().-]/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !digits.startsWith("1")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  // Do not guess country codes or match internal extensions.
  return null;
}

export function projectCrmRecord(record, stages = {}) {
  const source = unpackProperties(record.properties ?? {});
  const properties = { ...source, ...record.local_fields };
  const field = (...keys) => String(keys.map(key => source[key]).find(value => value != null && value !== "") ?? "").slice(0, 500);
  const view_fields = {
    email: field("email"), phone: field("phone", "mobilephone"), company: field("company", "name", "domain"),
    stage: field("lifecyclestage", "hs_lead_status", "dealstage", "hs_pipeline_stage"),
    amount: field("amount"), close_date: field("closedate"), domain: field("domain"),
    ...(["contacts", "companies"].includes(record.object_type) ? { address: field("address"), website: field("website"), postal_code: field("zip") } : {}),
    preview: String(record.body_preview ?? "").slice(0, 500),
    ...(["contacts", "companies"].includes(record.object_type) ? projectCrmImages(source, record.portal_id) : {}),
    ...(["contacts", "companies"].includes(record.object_type) ? projectCrmLocation(source) : {}),
  };
  if (stages[`${record.portal_id}:${record.object_type}:${view_fields.stage}`]) view_fields.stage_label = stages[`${record.portal_id}:${record.object_type}:${view_fields.stage}`];
  const identities = new Map();
  function add(kind, value) {
    const normalized = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
    if (normalized) identities.set(`${kind}:${normalized}`, { kind, value: normalized });
  }
  if (!record.archived && record.object_type === "contacts") {
    add("email", properties.email);
    for (const email of String(properties.hs_additional_emails ?? "").split(";")) add("email", email);
    for (const key of ["phone", "mobilephone", "hs_calculated_phone_number", "hs_calculated_mobile_number"]) add("phone", properties[key]);
  }
  const assets = new Map();
  if (record.source === "hubspot" && /^\d+$/.test(record.portal_id ?? "")) {
    for (const fileId of String(properties.hs_attachment_ids ?? "").split(/[;,\s]+/).filter(id => /^\d+$/.test(id))) {
      const id = `hubspot:${record.portal_id}:file:${fileId}`;
      assets.set(id, { id, kind: "file", portal_id: record.portal_id, remote_id: fileId, source_url: null });
    }
    const url = properties.hs_call_recording_url;
    if (typeof url === "string" && url.trim()) {
      const id = `hubspot:${record.portal_id}:recording:${createHash("sha256").update(url).digest("hex")}`;
      assets.set(id, { id, kind: "recording", portal_id: record.portal_id, remote_id: null, source_url: url });
    }
  }
  return { view_fields, identities: [...identities.values()], assets: [...assets.values()] };
}
