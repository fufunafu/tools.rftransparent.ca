import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const contact = "hubspot:1:contacts:1", company = "hubspot:1:companies:1", second = "hubspot:1:contacts:2";
const actor = "rep@example.com";
beforeAll(async () => {
  db = new PGlite();
  await db.exec("set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;");
  for (const file of ["20261027023000_hubspot_crm.sql", "20261027183000_crm_workflows.sql", "20261027230000_crm_directory_filters.sql", "20261028022000_crm_directory_workflows.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (const [id, type, title] of [[contact, "contacts", "Alex"], [second, "contacts", "Casey"], [company, "companies", "Example Construction"]]) {
    await db.query(`insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,owner_email,occurred_at,view_fields,properties,property_history)
      values($1,$2,'hubspot','1',split_part($1,':',4),$3,'original@example.com','2025-01-01','{"stage":"lead","city":"Toronto"}','{"original":"retained"}','{"past":"retained"}')`, [id, type, title]);
  }
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });
const edit = async (id: string, version: number, fields: Record<string, string>, companyId: string | null = null) => db.query("select crm_edit_directory_record($1,$2,$3,$4,$5) version", [id, version, fields, companyId, actor]);
const bulk = (kind = "owner") => ({ requestId: "12345678-1234-4123-8123-123456789012", type: "contacts", records: [{ id: contact, version: 1 }, { id: second, version: 1 }], change: kind === "task" ? { kind, title: "Follow up", body: "Review request", dueAt: "2030-01-01T12:00:00Z" } : { kind, value: "next@example.com" } });
const runBulk = async (payload: ReturnType<typeof bulk>, email = actor) => (await db.query<{ result: { updated: number; records: { taskId?: string }[] } }>("select crm_bulk_directory_action($1,$2,$3) result", [payload.requestId, payload, email])).rows[0].result;

it("edits contacts and companies, links an existing company, preserves imports, and audits effective values", async () => {
  await edit(contact, 1, { title: "Alex Updated", owner_email: "", city: "Ottawa", country: "Canada", stage: "customer" }, company);
  await edit(company, 1, { website: "https://example.com", address: "123 Example St", owner_email: actor });
  const row = (await db.query("select owner_email,filter_owner,filter_city,filter_stage from crm_directory where id=$1", [contact])).rows[0];
  expect(row).toEqual({ owner_email: null, filter_owner: "", filter_city: "ottawa", filter_stage: "customer" });
  const source = (await db.query("select title,properties,property_history,local_fields from crm_records where id=$1", [contact])).rows[0];
  expect(source).toMatchObject({ title: "Alex", properties: { original: "retained" }, property_history: { past: "retained" }, local_fields: { title: "Alex Updated", company: "Example Construction" } });
  expect((await db.query("select * from crm_links where from_id=$1 and to_id=$2 and source='tools'", [contact, company])).rows).toHaveLength(1);
  const audit = (await db.query<{ detail: unknown }>("select detail from crm_audit where record_id=$1 and action='record_updated'", [contact])).rows[0].detail;
  expect(audit).toMatchObject({ before: { title: "Alex", owner_email: "original@example.com", city: "Toronto", stage: "lead" }, after: { owner_email: "", stage: "customer" } });
  // A later import may change source ownership, but local assignment wins.
  await db.query("update crm_records set owner_email='import@example.com' where id=$1", [contact]);
  expect((await db.query("select owner_email from crm_directory where id=$1", [contact])).rows[0]).toEqual({ owner_email: null });
});
it("rejects stale edits, invalid fields, and linking to an unavailable company", async () => {
  await expect(edit(contact, 9, { title: "Stale" })).rejects.toThrow("changed");
});
it("rejects fields outside the allowed local edit set", async () => {
  await expect(edit(contact, 1, { properties: "replace original" })).rejects.toThrow("Invalid fields");
});
it("does not link contacts to another contact", async () => {
  await expect(edit(contact, 1, { title: "Alex" }, second)).rejects.toThrow("Company unavailable");
});
it("applies a bulk assignment once and returns the original result on an identical retry", async () => {
  const payload = bulk();
  const first = await runBulk(payload), retry = await runBulk(payload);
  expect(first.updated).toBe(2); expect(retry).toEqual(first);
  expect((await db.query("select count(*)::int n from crm_audit where action='record_updated'")).rows[0]).toEqual({ n: 2 });
  expect((await db.query("select distinct filter_owner from crm_directory where object_type='contacts'")).rows).toEqual([{ filter_owner: "next@example.com" }]);
});
it("rolls back the whole bulk action when any selected record changed", async () => {
  await edit(second, 1, { title: "Changed" });
  await db.exec("savepoint failed_bulk");
  await expect(runBulk(bulk())).rejects.toThrow("Selection changed");
  await db.exec("rollback to savepoint failed_bulk");
  expect((await db.query("select version,local_fields from crm_records where id=$1", [contact])).rows[0]).toEqual({ version: 1, local_fields: {} });
  expect((await db.query("select * from crm_bulk_requests")).rows).toHaveLength(0);
});
it("rejects reusing a request for another payload or actor", async () => {
  const payload = bulk(); await runBulk(payload);
  await expect(runBulk(payload, "other@example.com")).rejects.toThrow("already used");
});
it("creates exactly one linked, reminder-free task per selected record with auditable attribution", async () => {
  const payload = bulk("task"); const first = await runBulk(payload); await runBulk(payload);
  expect(first.records).toHaveLength(2);
  expect((await db.query("select owner_email,reminder_enabled from crm_records where object_type='tasks'")).rows).toEqual([{ owner_email: actor, reminder_enabled: false }, { owner_email: actor, reminder_enabled: false }]);
  expect((await db.query("select * from crm_audit where action='followup_created'")).rows).toHaveLength(2);
  await db.query("select crm_refresh_followups(100)");
  expect((await db.query("select open_task_count,next_task_title from crm_directory where id=$1", [contact])).rows[0]).toEqual({ open_task_count: 1, next_task_title: "Follow up" });
});
it("keeps saved views private and uses optimistic versions", async () => {
  const id = "12345678-1234-4123-8123-123456789012";
  await db.query("select crm_save_view($1,0,'contacts','Ontario',$2,$3)", [id, { search: "Ontario" }, actor]);
  expect((await db.query("select owner_email,version from crm_saved_views where id=$1", [id])).rows[0]).toEqual({ owner_email: actor, version: 1 });
  await expect(db.query("select crm_save_view($1,1,'contacts','Stolen',$2,'other@example.com')", [id, {}])).rejects.toThrow("unavailable");
});
it("recomputes follow-up summaries after task completion, changed links and archived activities", async () => {
  await db.exec(`insert into crm_records(id,object_type,source,title,occurred_at) values('tools:call','calls','tools','Called','2026-01-01'),('tools:note','notes','tools','Internal note','2026-02-01');`);
  await db.query("insert into crm_links(from_id,to_id,source) values('tools:call',$1,'tools'),('tools:note',$1,'tools')", [contact]);
  await runBulk(bulk("task"));
  await db.query("select crm_refresh_followups(100)");
  expect((await db.query("select last_contacted_at::text,open_task_count from crm_followup_summary where record_id=$1", [contact])).rows[0]).toEqual({ last_contacted_at: "2026-01-01 00:00:00+00", open_task_count: 1 });
  await db.exec("update crm_records set task_status_override='completed' where object_type='tasks'; update crm_records set archived=true where id='tools:call';");
  await db.query("select crm_refresh_followups(100)");
  expect((await db.query("select last_contacted_at,open_task_count,next_task_id from crm_followup_summary where record_id=$1", [contact])).rows[0]).toEqual({ last_contacted_at: null, open_task_count: 0, next_task_id: null });
  await db.exec("update crm_records set archived=false where id='tools:call';"); await db.query("select crm_refresh_followups(100)");
  await db.query("delete from crm_links where from_id='tools:call' and to_id=$1", [contact]); await db.query("select crm_refresh_followups(100)");
  expect((await db.query("select last_contacted_at from crm_followup_summary where record_id=$1", [contact])).rows[0]).toEqual({ last_contacted_at: null });
});
it("reduces batch sizes and persists a cooldown after slow or failed requests", async () => {
  await db.exec("select crm_worker_feedback('index',2000,false);");
  expect((await db.query("select batch_size,failures from crm_worker_backoff where worker='index'")).rows[0]).toEqual({ batch_size: 10, failures: 0 });
  await db.exec("select crm_worker_feedback('index',6000,false); select crm_worker_feedback('index',200,true);");
  expect((await db.query("select batch_size,failures,pause_until>now() paused from crm_worker_backoff where worker='index'")).rows[0]).toEqual({ batch_size: 2, failures: 1, paused: true });
});
it("keeps new state and mutation functions inaccessible to browser database roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege($1,'crm_saved_views','select') allowed", [role])).rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'crm_bulk_directory_action(uuid,jsonb,text)','execute') allowed", [role])).rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'crm_edit_directory_record(text,integer,jsonb,text,text)','execute') allowed", [role])).rows[0].allowed).toBe(false);
  }
});
