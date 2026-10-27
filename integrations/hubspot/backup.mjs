import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { HUBSPOT_TYPES, hubspotClient, readOwners, readHubspotPage } from "../../src/lib/crm/hubspot.mjs";

// Usage: node --env-file=.env.local integrations/hubspot/backup.mjs [backup-directory]
// Files contain customer data. Default location is ignored by Git; no credential is written.
const directory = resolve(process.argv[2] || `.artifacts/hubspot/${new Date().toISOString().slice(0,10)}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = await open(`${directory}/.lock`, "wx", 0o600).catch(() => { throw new Error("Backup already running, or an interrupted lock needs review."); });
const request = hubspotClient(process.env.HUBSPOT_ACCESS_TOKEN);
async function save(name, value) {
  const path = `${directory}/${name}`;
  await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
try {
  const account = await request("/account-info/v3/details");
  if (String(account.portalId) !== process.env.HUBSPOT_PORTAL_ID) throw new Error("HubSpot account does not match HUBSPOT_PORTAL_ID.");
  let state;
  try { state = JSON.parse(await readFile(`${directory}/checkpoint.json`, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  state ??= { portalId: String(account.portalId), startedAt: new Date().toISOString(), typeIndex: 0, archived: false, after: null, pages: 0, counts: {} };
  if (state.portalId !== String(account.portalId)) throw new Error("Backup account mismatch.");
  await save("account.json", account);
  const owners = await readOwners(request);
  await save("owners.json", owners);
  while (state.typeIndex < HUBSPOT_TYPES.length) {
    const type = HUBSPOT_TYPES[state.typeIndex];
    const definitions = await request(`/crm/v3/properties/${type}`);
    await save(`${type}-properties.json`, definitions);
    const properties = definitions.results.map(property => property.name);
    if (["deals", "tickets"].includes(type)) await save(`${type}-pipelines.json`, await request(`/crm/v3/pipelines/${type}`));
    while (true) {
      const page = await readHubspotPage(request, { portalId: state.portalId, type, properties, owners, after: state.after, archived: state.archived });
      const group = `${type}-${state.archived ? "archived" : "active"}`;
      const name = `${String(state.pages).padStart(6,"0")}-${group}.json`;
      await save(name, page);
      if (page.unavailable) state.unavailable = [...new Set([...(state.unavailable ?? []), page.unavailable])];
      state.pages++;
      state.counts[group] = (state.counts[group] ?? 0) + page.records.length;
      if (page.after === null) {
        if (!state.archived) { state.archived = true; state.after = null; }
        else { state.typeIndex++; state.archived = false; state.after = null; }
      } else {
        if (String(page.after) === String(state.after)) throw new Error("Repeated record cursor.");
        state.after = page.after;
      }
      if (state.typeIndex === HUBSPOT_TYPES.length) state.completedAt = new Date().toISOString();
      await save("checkpoint.json", state);
      if (state.pages % 10 === 0 || page.after === null) console.log(JSON.stringify({ type, group, records: state.counts[group], pages: state.pages, complete: Boolean(state.completedAt), unavailable: page.unavailable }));
      if (page.after === null) break;
    }
  }
  await save("coverage.json", {
    ...state,
    included: ["Core CRM records", "All accessible property values and histories", "Core CRM associations", "Active and archived owners", "Deal and ticket pipelines", "Archived records still available through the API"],
    notYetIncluded: ["Attachment binaries and call recording files", "Custom objects", "Marketing assets, forms, lists, workflows and conversations", "Permanently deleted records", "Sensitive properties requiring additional permissions"],
    note: "An API snapshot is not a complete HubSpot account export. Do not retire HubSpot before remaining data and functionality are reconciled.",
  });
  console.log("Core CRM backup complete. Review coverage.json before treating the migration as complete.");
} finally {
  await lock.close();
  const { unlink } = await import("node:fs/promises");
  await unlink(`${directory}/.lock`);
}
