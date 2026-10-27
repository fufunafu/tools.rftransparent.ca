import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { normalizeHubspotRecord } from "./hubspot.mjs";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await readFile("supabase/migrations/20261027023000_hubspot_crm.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261027031500_crm_counts_index.sql", "utf8"));
  await db.exec("begin;" + await readFile("supabase/migrations/20261027032500_crm_live_counts.sql", "utf8") + "commit;");
}, 30000);
afterAll(async () => { await db?.close(); });

describe("CRM database", () => {
  it("denies browser roles direct access to CRM data and privileged functions", async () => {
    const result = await db.query<{ read: boolean; execute: boolean }>("select has_table_privilege('authenticated','crm_records','select') as read,has_function_privilege('authenticated','crm_import_page(jsonb,jsonb)','execute') as execute");
    expect(result.rows[0]).toEqual({ read: false, execute: false });
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='crm_records'");
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it("imports idempotently and preserves task overrides, local notes and links during later syncs", async () => {
    const task = normalizeHubspotRecord("40088916", "tasks", { id: "11", properties: { hs_task_subject: "Call client", hs_timestamp: "2026-10-30T10:00:00Z", hubspot_owner_id: "1" } }, { "1": { email: "rep@example.com" } });
    const contact = normalizeHubspotRecord("40088916", "contacts", { id: "21", properties: { firstname: "Client", email: "client@example.com", custom_project: "Preserve" }, propertiesWithHistory: { custom_project: [{ value: "Old" }] } });
    const links = [{ from_id: task.id, to_id: contact.id, label: "task_to_contact" }];
    await db.query("select crm_import_page($1,$2)", [JSON.stringify([task, contact]), JSON.stringify(links)]);
    await db.query("select crm_update_task($1,1,'completed','2026-11-01T10:00:00Z','rep@example.com',false)", [task.id]);
    const noteId = "11111111-1111-4111-8111-111111111111";
    await db.query("select crm_create_record($1,'notes','Meeting notes','Keep this note','{}',now(),null,$2,'rep@example.com')", [noteId, contact.id]);
    await db.query("select crm_import_page($1,$2)", [JSON.stringify([{ ...task, title: "Updated upstream" }, contact]), JSON.stringify(links)]);
    const rows = await db.query<{ title: string; effective_task_status: string; due: string }>("select title,effective_task_status,effective_due_at::text as due from crm_records where id=$1", [task.id]);
    expect(rows.rows[0]).toMatchObject({ title: "Updated upstream", effective_task_status: "completed" });
    expect(rows.rows[0].due).toContain("2026-11-01");
    const related = await db.query("select * from crm_related_records($1)", [contact.id]);
    expect(related.rows).toHaveLength(2);
    const counts = await db.query<{ count: number }>("select count(*)::int as count from crm_records");
    expect(counts.rows[0].count).toBe(3);
    const history = await db.query<{ property_history: object }>("select property_history from crm_records where id=$1", [contact.id]);
    expect(history.rows[0].property_history).toEqual({ custom_project: [{ value: "Old" }] });
  });

  it("rejects stale task edits and other staff editing someone else's task", async () => {
    await expect(db.query("select crm_update_task('hubspot:40088916:tasks:11',1,'open',now(),'rep@example.com',false)")).rejects.toThrow("Task changed");
    await expect(db.query("select crm_update_task('hubspot:40088916:tasks:11',2,'open',now(),'other@example.com',false)")).rejects.toThrow("Only the task owner");
  });

  it("prevents concurrent syncs and rejects expired workers before writing records", async () => {
    const token = "22222222-2222-4222-8222-222222222222";
    const claim = await db.query<{ progress: unknown }>("select crm_claim_sync('40088916',$1,false) as progress", [token]);
    expect(claim.rows[0].progress).not.toBeNull();
    const next = await db.query<{ progress: unknown }>("select crm_claim_sync('40088916','33333333-3333-4333-8333-333333333333',true) as progress");
    expect(next.rows[0].progress).toBeNull();
    await expect(db.query("select crm_commit_sync_page('40088916','33333333-3333-4333-8333-333333333333','[]','[]','{}',false)")).rejects.toThrow("lease expired");
  });

  it("rolls back an entire imported page on invalid data", async () => {
    const contact = normalizeHubspotRecord("40088916", "contacts", { id: "99", properties: { firstname: "Should roll back" } });
    const bad = { ...contact, id: "tools:forbidden", source: "tools" };
    await expect(db.query("select crm_import_page($1,'[]')", [JSON.stringify([contact, bad])])).rejects.toThrow();
    const result = await db.query("select id from crm_records where id=$1", [contact.id]);
    expect(result.rows).toEqual([]);
  });

  it("keeps exact live totals through repeat imports, archival, restoration and deletion", async () => {
    const verify = async () => {
      const saved = await db.query("select * from crm_counts() order by object_type,source");
      const actual = await db.query("select object_type,source,count(*) as total from crm_records where not archived group by object_type,source order by object_type,source");
      expect(saved.rows).toEqual(actual.rows);
    };
    await verify();
    const item = normalizeHubspotRecord("40088916", "contacts", { id: "100", properties: { firstname: "Count check" } });
    for (const archived of [false, false, true, true, false]) {
      await db.query("select crm_import_page($1,'[]')", [JSON.stringify([{ ...item, archived }])]);
      await verify();
    }
    await db.query("delete from crm_records where id=$1", [item.id]);
    await verify();
    const grant = await db.query<{ read: boolean }>("select has_table_privilege('authenticated','crm_record_counts','select') as read");
    expect(grant.rows[0].read).toBe(false);
  });
});
