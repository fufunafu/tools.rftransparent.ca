import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { HUBSPOT_TYPES } from "../../src/lib/crm/hubspot.mjs";
import { packHubspotRecord } from "../../src/lib/crm/storage.mjs";
import { commitCrmPage, CrmImportPaused } from "../../src/lib/crm/commit-page.mjs";

import { createCrmPacer, boundedCrmQuery } from "../../src/lib/crm/worker-pacing.mjs";

// Uses the same leased, atomic page commits as the live worker. Safe to resume.
const directory = resolve(process.argv[2] || `.artifacts/hubspot/${new Date().toISOString().slice(0,10)}`);
const backup = JSON.parse(await readFile(`${directory}/checkpoint.json`, "utf8"));
if (!backup.completedAt || backup.portalId !== process.env.HUBSPOT_PORTAL_ID) throw new Error("A complete backup of the configured HubSpot account is required.");
const files = (await readdir(directory)).filter(file => /^\d{6}-[a-z]+-(active|archived)\.json$/.test(file)).sort();
if (files.length !== backup.pages) throw new Error("Backup page count mismatch.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pacer = await createCrmPacer(db, "import", 30);
if (pacer.paused) throw new CrmImportPaused();
const lease = randomUUID();
const claim = await boundedCrmQuery(db.rpc("crm_claim_sync", { p_portal: backup.portalId, p_token: lease, p_restart: false }));
if (claim.error) throw new Error(`Cannot claim CRM import (${claim.error.code}).`);
if (!claim.data) throw new Error("Import already running or completed. Inspect the sync state before starting another import.");
const progress = claim.data;
if (progress.backupId && progress.backupId !== backup.startedAt) throw new Error("Another backup is being imported.");
if (!progress.backupId && Object.values(progress.counts).some(count => count > 0)) throw new Error("A live import is in progress; do not mix it with a backup load.");
progress.backupId = backup.startedAt;
progress.unavailable = backup.unavailable ?? [];
try {
  for (const name of (await readdir(directory)).filter(name => /^(owners|account)\.json$|-(properties|pipelines)\.json$/.test(name))) {
    const key = `${backup.portalId}:${name.replace(/\.json$/, "").replace(/-(properties|pipelines)$/, ":$1")}`;
    const saved = await boundedCrmQuery(db.from("crm_metadata").upsert({ key, value: JSON.parse(await readFile(`${directory}/${name}`, "utf8")), updated_at: new Date().toISOString() }));
    if (saved.error) throw new Error(`Metadata import failed (${saved.error.code}).`);
  }
  for (let index = progress.backupPage ?? 0; index < files.length; index++) {
    const previousProgress = structuredClone(progress);
    const name = files[index];
    const [, type, phase] = name.match(/^\d{6}-([a-z]+)-(active|archived)\.json$/);
    const page = JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
    const group = `${type}-${phase}`;
    const typeIndex = HUBSPOT_TYPES.indexOf(type);
    progress.counts[group] = (progress.counts[group] ?? 0) + page.records.length;
    progress.typeIndex = page.after === null && phase === "archived" ? typeIndex + 1 : typeIndex;
    progress.archived = page.after === null ? phase === "active" : phase === "archived";
    progress.after = page.after;
    progress.backupPage = index + 1;
    const complete = index === files.length - 1;
    if (complete) progress.completedAt = new Date().toISOString();
    // Properties/history are stored once in their own columns; raw is retained in the backup.
    const records = page.records.map(packHubspotRecord);
    const payload = { p_portal: backup.portalId, p_token: lease, p_records: records, p_links: page.links, p_progress: progress, p_complete: complete };
    await commitCrmPage(db, payload, previousProgress, pacer);
    await pacer.wait(Infinity);
    if (index % 50 === 0 || complete) console.log(JSON.stringify({ importedPages: index + 1, totalPages: files.length, complete }));
  }
  const counts = await boundedCrmQuery(db.rpc("crm_counts"));
  if (counts.error) throw new Error("Import finished but count verification failed.");
  for (const type of HUBSPOT_TYPES) {
    const actual = Number(counts.data.find(row => row.object_type === type && row.source === "hubspot")?.total ?? 0);
    if (actual !== backup.counts[`${type}-active`]) throw new Error(`Count mismatch for ${type}; review before claiming completion.`);
  }
  console.log("Core CRM database import complete. Active counts match the backup for all nine object types.");
} catch (error) {
  if (error instanceof CrmImportPaused) { console.log(error.message); process.exitCode = 1; }
  else {
  await boundedCrmQuery(db.from("crm_sync_state").update({ status: "error", last_error: error.message }).eq("portal_id", backup.portalId).eq("lease_token", lease));
  throw error;
  }
} finally {
  await pacer.finish();
  await boundedCrmQuery(db.from("crm_sync_state").update({ lease_until: null }).eq("portal_id", backup.portalId).eq("lease_token", lease));
}
