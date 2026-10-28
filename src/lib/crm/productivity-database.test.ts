import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const contact = "hubspot:1:contacts:1", company = "hubspot:1:companies:1", importedTask = "hubspot:1:tasks:1", importedNote = "hubspot:1:notes:1";
const rep = "rep@example.com", other = "other@example.com";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile("supabase/migrations/20261027023000_hubspot_crm.sql", "utf8"));
  await db.exec("begin;" + await readFile("supabase/migrations/20261027032500_crm_live_counts.sql", "utf8") + "commit;");
  for (const file of ["20261027183000_crm_workflows.sql", "20261027230000_crm_directory_filters.sql", "20261028022000_crm_directory_workflows.sql", "20261028050000_crm_productivity.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  for (const [id, type, title, extra] of [[contact, "contacts", "Alex", ""], [company, "companies", "Example Glass", ""], [importedTask, "tasks", "Imported follow-up", "open"], [importedNote, "notes", "Imported note", ""]]) {
    await db.query(`insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,body,owner_email,occurred_at,due_at,task_status,view_fields,properties,property_history)
      values($1,$2,'hubspot','1',split_part($1,':',4),$3,'Original body','original@example.com','2026-01-05',case when $2='tasks' then '2026-01-06'::timestamptz end,nullif($4,''),'{"stage":"lead"}','{"original":"retained"}','{"past":"retained"}')`, [id, type, title, extra]);
  }
  await db.query("insert into crm_links(from_id,to_id,source) values($1,$2,'hubspot'),($3,$2,'hubspot')", [importedTask, contact, importedNote]);
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

const create = (n: number, type: string, opts: { related?: string[]; owner?: string | null; details?: Record<string, string>; due?: string | null; actor?: string } = {}) =>
  db.query<{ id: string }>("select crm_create_record_ex($1,$2,$3,'Body text','{}',now(),$4,$5,$6,$7,$8) id",
    [uuid(n), type, `${type} ${n}`, opts.due ?? (type === "tasks" ? "2030-01-01T12:00:00Z" : null), opts.related ?? [], opts.actor ?? rep, opts.owner ?? null, opts.details ?? {}]).then(result => result.rows[0].id);
const row = async (id: string) => (await db.query<Record<string, unknown>>("select * from crm_records where id=$1", [id])).rows[0];
const audit = async (id: string) => (await db.query<{ action: string; detail: Record<string, unknown> }>("select action,detail from crm_audit where record_id=$1 order by id", [id])).rows;
async function rejects(sql: string, params: unknown[], message: string) {
  await db.exec("savepoint expected_failure");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_failure");
}

it("creates an assigned task with details and several associations once, even when retried", async () => {
  const id = await create(1, "tasks", { related: [contact, company], owner: other, details: { priority: "high", task_type: "call" } });
  expect(await create(1, "tasks", { related: [contact, company], owner: other, details: { priority: "high", task_type: "call" } })).toBe(id);
  expect(await row(id)).toMatchObject({ owner_email: other, created_by_email: rep, local_fields: { owner_email: other, priority: "high", task_type: "call" } });
  expect((await db.query("select to_id from crm_links where from_id=$1 order by to_id", [id])).rows).toEqual([{ to_id: company }, { to_id: contact }]);
  expect((await audit(id)).map(entry => entry.action)).toEqual(["created", "details_set"]);
  expect((await db.query("select count(*)::int n from crm_records where id=$1", [id])).rows[0]).toEqual({ n: 1 });
});

it("rejects unknown detail keys and tasks explicitly left without an owner", async () => {
  await rejects("select crm_create_record_ex($1,'notes','Note','','{}',now(),null,'{}',$2,null,$3)", [uuid(2), rep, { secret: "x" }], "Invalid details");
  await rejects("select crm_create_record_ex($1,'tasks','Task','','{}',now(),now(),'{}',$2,'',$3)", [uuid(3), rep, {}], "Tasks need an owner");
});

it("lets the author or management edit Tools activity and keeps imported activity read-only", async () => {
  const id = await create(4, "calls", { related: [contact], details: { call_outcome: "voicemail" } });
  await rejects("select crm_edit_activity($1,1,'Edited','New body',now(),'{}',$2,false)", [id, other], "Only the author or management");
  const version = (await db.query<{ v: number }>("select crm_edit_activity($1,1,'Edited call','New body','2026-02-01T10:00:00Z',$2,$3,false) v", [id, { call_outcome: "connected", duration_minutes: "12" }, rep])).rows[0].v;
  expect(version).toBe(2);
  expect(await row(id)).toMatchObject({ title: "Edited call", body: "New body", local_fields: { call_outcome: "connected", duration_minutes: "12" }, view_fields: { preview: "New body" } });
  expect((await audit(id)).at(-1)).toMatchObject({ action: "activity_updated", detail: { before: { title: "calls 4", call_outcome: "voicemail" }, after: { title: "Edited call", call_outcome: "connected" } } });
  await rejects("select crm_edit_activity($1,2,'Again','',now(),'{}',$2,false)", [id, other], "Only the author or management");
  expect((await db.query<{ v: number }>("select crm_edit_activity($1,2,'Manager fix','',now(),'{}',$2,true) v", [id, other])).rows[0].v).toBe(3);
  await rejects("select crm_edit_activity($1,1,'Changed','',now(),'{}',$2,true)", [importedNote, rep], "Imported activity is read-only");
  await rejects("select crm_edit_activity($1,9,'Stale','',now(),'{}',$2,true)", [id, rep], "changed");
});

it("reassigns tasks, edits imported titles locally, and keeps the assignment through a re-import", async () => {
  await rejects("select crm_update_task_details($1,1,'Mine now','Original body',$2,'{}',$3,false)", [importedTask, rep, rep], "Only the task owner");
  const version = (await db.query<{ v: number }>("select crm_update_task_details($1,1,'Call Alex back','Original body',$2,$3,$4,true) v", [importedTask, rep, { priority: "high" }, other])).rows[0].v;
  expect(version).toBe(2);
  expect(await row(importedTask)).toMatchObject({ title: "Imported follow-up", owner_email: rep, local_fields: { title: "Call Alex back", owner_email: rep, priority: "high" } });
  await rejects("select crm_update_task_details($1,2,'Call Alex back','Rewritten',$2,'{}',$2,false)", [importedTask, rep], "Imported task notes are read-only");
  await rejects("select crm_update_task_details($1,2,'Call Alex back','Original body','not-an-email','{}',$2,false)", [importedTask, rep], "Invalid task");
  await db.query("select crm_import_page($1,'[]')", [[{ id: importedTask, object_type: "tasks", source: "hubspot", portal_id: "1", hubspot_id: "1", title: "Imported follow-up", owner_email: "original@example.com", due_at: "2026-01-06", task_status: "open", properties: {}, property_history: {} }]]);
  expect(await row(importedTask)).toMatchObject({ owner_email: rep, local_fields: { owner_email: rep } });
  // The new owner (not only management) can keep editing.
  const tool = await create(5, "tasks", { related: [contact] });
  expect((await db.query<{ v: number }>("select crm_update_task_details($1,1,'Renamed','New notes',$2,'{}',$3,false) v", [tool, other, rep])).rows[0].v).toBe(2);
  expect(await row(tool)).toMatchObject({ title: "Renamed", body: "New notes", owner_email: other });
  expect((await db.query<{ v: number }>("select crm_update_task_details($1,2,'Renamed again','New notes',$2,'{}',$2,false) v", [tool, other])).rows[0].v).toBe(3);
});

it("soft-deletes and restores with creator or management rules, and a re-import keeps the deletion", async () => {
  const note = await create(6, "notes", { related: [contact] });
  await rejects("select crm_set_deleted($1,1,true,$2,false)", [note, other], "Only the creator or management");
  expect((await db.query<{ v: number }>("select crm_set_deleted($1,1,true,$2,false) v", [note, rep])).rows[0].v).toBe(2);
  expect(await row(note)).toMatchObject({ archived: true, local_fields: { deleted_by: rep } });
  expect((await db.query<{ v: number }>("select crm_set_deleted($1,2,false,$2,false) v", [note, rep])).rows[0].v).toBe(3);
  expect(await row(note)).toMatchObject({ archived: false, local_fields: {} });

  await rejects("select crm_set_deleted($1,1,true,$2,false)", [contact, rep], "Only the creator or management");
  await db.query("select crm_set_deleted($1,1,true,$2,true)", [contact, other]);
  await db.query("select crm_import_page($1,'[]')", [[{ id: contact, object_type: "contacts", source: "hubspot", portal_id: "1", hubspot_id: "1", title: "Alex", archived: false, properties: { original: "retained" }, property_history: {} }]]);
  expect(await row(contact)).toMatchObject({ archived: true, properties: { original: "retained" } });
  expect((await db.query("select total::int from crm_record_counts where object_type='contacts' and source='hubspot'")).rows[0]).toEqual({ total: 0 });
  await rejects("select crm_set_deleted($1,1,false,$2,true)", [company, other], "Only records deleted in Tools can be restored");
  await rejects("select crm_set_deleted($1,1,true,$2,true)", ["missing", other], "Record unavailable");
  expect((await audit(contact)).map(entry => entry.action)).toEqual(["deleted"]);
});

it("adds and removes Tools associations but never imported ones", async () => {
  const freshCompany = await create(7, "companies");
  expect((await db.query<{ added: boolean }>("select crm_link_records($1,$2,$3) added", [contact, freshCompany, rep])).rows[0].added).toBe(true);
  expect((await db.query<{ added: boolean }>("select crm_link_records($1,$2,$3) added", [freshCompany, contact, rep])).rows[0].added).toBe(false);
  await rejects("select crm_link_records($1,$2,$3)", [contact, contact, rep], "Invalid association");
  await rejects("select crm_link_records($1,$2,$3)", [importedNote, importedTask, rep], "cannot be associated");
  expect((await db.query<{ n: number }>("select crm_unlink_records($1,$2,$3) n", [freshCompany, contact, rep])).rows[0].n).toBe(1);
  await rejects("select crm_unlink_records($1,$2,$3)", [importedTask, contact, rep], "Only associations added in Tools");
  expect((await audit(contact)).map(entry => entry.action)).toEqual(["association_added", "association_removed"]);
});

it("pins one linked activity and drops the pin when that activity is deleted", async () => {
  const note = await create(8, "notes", { related: [contact] });
  await rejects("select crm_pin_activity($1,$2,$3)", [company, note, rep], "Pin an activity linked");
  await db.query("select crm_pin_activity($1,$2,$3)", [contact, importedNote, rep]);
  await db.query("select crm_pin_activity($1,$2,$3)", [contact, note, rep]);
  expect((await db.query("select activity_id from crm_pins where record_id=$1", [contact])).rows).toEqual([{ activity_id: note }]);
  await db.query("select crm_set_deleted($1,1,true,$2,false)", [note, rep]);
  expect((await db.query("select * from crm_pins")).rows).toHaveLength(0);
});

it("summarizes team activity by effective owner for a period", async () => {
  await create(9, "calls", { related: [contact] });
  await create(10, "emails", { related: [contact], owner: other });
  const done = await create(11, "tasks", { due: "2026-01-02T00:00:00Z" });
  await db.query("select crm_update_task($1,1,'completed','2026-01-02T00:00:00Z',$2,false)", [done, rep]);
  await db.query("update crm_records set occurred_at='2026-01-03' where id like 'tools:%' and object_type in ('calls','emails')");
  await db.query("select crm_edit_directory_record($1,1,$2,null,$3)", [contact, { owner_email: rep }, rep]);
  const report = (await db.query<{ r: { people: Record<string, unknown>[]; stages: unknown[] } }>("select crm_team_report('2026-01-01','2026-02-01') r")).rows[0].r;
  expect(report.people).toEqual(expect.arrayContaining([
    expect.objectContaining({ owner: rep, calls: 1, contacts: 1, tasks_completed: 1, tasks_overdue: 0 }),
    expect.objectContaining({ owner: other, emails: 1 }),
    expect.objectContaining({ owner: "original@example.com", notes: 1, tasks_overdue: 1 }),
  ]));
  expect(report.stages).toEqual([{ value: "lead", label: "lead", count: 1 }]);
  await rejects("select crm_team_report('2026-02-01','2026-01-01')", [], "Invalid report period");
  await rejects("select crm_team_report('2024-01-01','2026-01-01')", [], "Invalid report period");
});

it("keeps every new function and table away from browser roles", async () => {
  const exposed = await db.query(`select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
    ('crm_create_record_ex','crm_edit_activity','crm_update_task_details','crm_set_deleted','crm_link_records','crm_unlink_records','crm_pin_activity','crm_team_report')
    and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`);
  expect(exposed.rows).toEqual([]);
  expect((await db.query("select has_table_privilege('anon','crm_pins','select') pins, has_table_privilege('authenticated','crm_exports','insert') exports")).rows[0]).toEqual({ pins: false, exports: false });
});

it("keeps the owner when none is chosen, audits notes in full, and lets a blank detail clear it", async () => {
  await db.query("update crm_records set owner_email=null where id=$1", [importedTask]);
  await db.query("select crm_update_task_details($1,1,'Imported follow-up','Original body',null,$2,$3,true)", [importedTask, { priority: "high" }, other]);
  expect(await row(importedTask)).toMatchObject({ owner_email: null, local_fields: { priority: "high" } });
  expect(Object.hasOwn((await row(importedTask)).local_fields as object, "owner_email")).toBe(false);
  await db.query("select crm_update_task_details($1,2,'Imported follow-up','Original body',null,$2,$3,true)", [importedTask, { priority: "" }, other]);
  expect(await row(importedTask)).toMatchObject({ local_fields: { priority: "" } });
  const task = await create(20, "tasks");
  const long = "x".repeat(5000);
  await db.query("select crm_update_task_details($1,1,'tasks 20',$2,null,'{}',$3,false)", [task, long, rep]);
  expect((await audit(task)).at(-1)?.detail).toMatchObject({ before: { notes: "Body text" }, after: { notes: long } });
  const call = await create(21, "calls", { details: { call_outcome: "busy" } });
  await db.query("select crm_edit_activity($1,1,'Call',$2,now(),$3,$4,false)", [call, long, { call_outcome: "" }, rep]);
  expect(await row(call)).toMatchObject({ local_fields: { call_outcome: "" } });
  await db.query("select crm_edit_activity($1,2,'Call','short',now(),'{}',$2,false)", [call, rep]);
  expect(((await audit(call)).at(-1)?.detail as { before: { body: string } }).before.body).toHaveLength(5000);
});

it("treats automatically captured activity as read-only and drops a pin when its link is removed", async () => {
  await db.query("insert into crm_records(id,object_type,source,title,occurred_at) values('tools:captured-1','calls','tools','Captured call',now())");
  await rejects("select crm_edit_activity('tools:captured-1',1,'Edited','',now(),'{}',$1,true)", [other], "Captured activity is read-only");
  const note = await create(22, "notes");
  await db.query("select crm_link_records($1,$2,$3)", [note, company, rep]);
  await db.query("select crm_pin_activity($1,$2,$3)", [company, note, rep]);
  await db.query("select crm_unlink_records($1,$2,$3)", [company, note, rep]);
  expect((await db.query("select * from crm_pins where record_id=$1", [company])).rows).toHaveLength(0);
});
