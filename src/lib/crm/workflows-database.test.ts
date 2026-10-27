import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectCrmRecord } from "./identity.mjs";

let db: PGlite;
const token = "11111111-1111-4111-8111-111111111111";
const otherToken = "22222222-2222-4222-8222-222222222222";
const taskId = "tools:33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await readFile("supabase/migrations/20261027023000_hubspot_crm.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/008_email_tables.sql", "utf8"));
  await db.exec("create table call_records(id uuid primary key,store_id text,call_start timestamptz,call_end timestamptz,from_number text,to_number text,direction text,duration_min numeric,endpoint text,source text);");
  // A legacy task exists before installing the new workflow defaults.
  await db.query("insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,owner_email,due_at,task_status,properties,property_history) values('hubspot:1:tasks:1','tasks','hubspot','1','1','Old task','rep@example.com',now()-interval '1 year','open','{\"original\":\"retained\"}','{\"original\":[{\"value\":\"older\"}]}')");
  await db.exec(await readFile("supabase/migrations/20261027183000_crm_workflows.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261027183500_crm_activity_capture.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261027192500_crm_workflow_query_paths.sql", "utf8"));
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function newTask(minutes = 30) {
  await db.query("select crm_create_record($1,'tasks','Follow up','Retain my note',$2,now(),now()+$3*interval '1 minute',null,'rep@example.com')", [taskId.slice(6), { reminder_enabled: true, reminder_minutes: 60 }, minutes]);
}
async function addContact(id: string, email: string) {
  await db.query("insert into crm_records(id,object_type,source,title,properties) values($1,'contacts','tools',$1,$2)", [id, { email }]);
}
async function indexAll() {
  const claimed = await db.query<{ record_id: string; revision: number; record: object }>("select * from crm_claim_projections($1,100)", [token]);
  const rows = claimed.rows.map(row => ({ record_id: row.record_id, revision: row.revision, ...projectCrmRecord(row.record) }));
  await db.query("select crm_commit_projections($1,$2)", [token, rows]);
  return rows;
}
async function enqueueEmail() {
  await db.exec("update crm_capture_settings set started_at=now()-interval '1 day'");
  await db.exec("insert into email_messages(message_id,thread_id,store_id,inbox,direction,from_email,to_email,subject,received_at,snippet) values('m1','t1','rf_transparent','info@glass-railing.com','inbound','client@example.com','info@glass-railing.com','Railing project',now()-interval '10 minutes','Preview'); update crm_capture_events set created_at=now()-interval '5 minutes'");
  const claim = await db.query<{ id: string; revision: number }>("select * from crm_claim_capture($1,10)", [token]);
  return claim.rows[0];
}

describe("CRM workflow database", () => {
  it("keeps legacy tasks quiet and preserves their original fields and history", async () => {
    expect((await db.query("select * from crm_claim_reminders($1,20)", [token])).rows).toHaveLength(0);
    expect((await db.query("select reminder_enabled,properties,property_history from crm_records where id='hubspot:1:tasks:1'")).rows[0]).toEqual({ reminder_enabled: false, properties: { original: "retained" }, property_history: { original: [{ value: "older" }] } });
  });
  it("denies browser access to workflows, source URLs and privileged mutations", async () => {
    for (const table of ["crm_identities", "crm_projection_queue", "crm_duplicate_reviews", "crm_assets", "crm_record_assets", "crm_reminder_deliveries", "crm_capture_events", "crm_capture_settings"]) {
      expect((await db.query<{ allowed: boolean }>("select has_table_privilege('authenticated',$1,'select') as allowed", [table])).rows[0].allowed).toBe(false);
    }
    const functions = await db.query<{ allowed: boolean }>("select has_function_privilege('anon',oid,'execute') as allowed from pg_proc where proname in ('crm_claim_reminders','crm_finish_capture','crm_review_duplicate','crm_claim_assets','crm_workflow_status')");
    expect(functions.rows).toHaveLength(5);
    expect(functions.rows.every(row => !row.allowed)).toBe(true);
  });
  it("claims a reminder once across repeated workers and records a single receipt", async () => {
    await newTask();
    const first = await db.query<{ id: string; kind: string }>("select * from crm_claim_reminders($1,20)", [token]);
    expect(first.rows).toHaveLength(1); expect(first.rows[0].kind).toBe("upcoming");
    expect((await db.query("select * from crm_claim_reminders($1,20)", [otherToken])).rows).toHaveLength(0);
    await db.query("select crm_finish_reminder($1,$2,'sent',null,'provider-id')", [first.rows[0].id, token]);
    expect((await db.query("select * from crm_claim_reminders($1,20)", [otherToken])).rows).toHaveLength(0);
    expect((await db.query("select count(*)::int n from crm_reminder_deliveries")).rows[0]).toEqual({ n: 1 });
  });
  it("cancels a claimed reminder when the task is completed or reminders are disabled", async () => {
    await newTask();
    await db.query("select * from crm_claim_reminders($1,20)", [token]);
    await db.query("select crm_update_task_settings($1,1,'completed',now()+interval '30 minutes','rep@example.com',false,false,60)", [taskId]);
    await db.query("select * from crm_claim_reminders($1,20)", [otherToken]);
    expect((await db.query("select status,error_code from crm_reminder_deliveries")).rows[0]).toEqual({ status: "cancelled", error_code: "task_changed" });
  });
  it("schedules a fresh reminder after rescheduling, while preserving prior delivery history", async () => {
    await newTask();
    const first = await db.query<{ id: string }>("select * from crm_claim_reminders($1,20)", [token]);
    await db.query("select crm_finish_reminder($1,$2,'sent')", [first.rows[0].id, token]);
    await db.query("select crm_update_task_settings($1,1,'open',now()+interval '45 minutes','rep@example.com',false,true,60)", [taskId]);
    const second = await db.query<{ id: string }>("select * from crm_claim_reminders($1,20)", [otherToken]);
    expect(second.rows).toHaveLength(1); expect(second.rows[0].id).not.toBe(first.rows[0].id);
  });
  it("sends only an overdue reminder when first processed after the due time", async () => {
    await newTask(-5);
    const result = await db.query("select kind from crm_claim_reminders($1,20)", [token]);
    expect(result.rows).toEqual([{ kind: "overdue" }]);
  });
  it("stops retries before the provider's idempotency guarantee expires", async () => {
    await newTask(); await db.query("select * from crm_claim_reminders($1,20)", [token]);
    await db.exec("update crm_reminder_deliveries set first_attempt_at=now()-interval '24 hours',lease_until=now()-interval '1 minute'");
    expect((await db.query("select * from crm_claim_reminders($1,20)", [otherToken])).rows).toHaveLength(0);
    expect((await db.query("select status from crm_reminder_deliveries")).rows[0]).toEqual({ status: "failed" });
  });
  it("keeps reminder edits inside the task ownership and version checks", async () => {
    await newTask();
    await db.exec("savepoint edit_check");
    await expect(db.query("select crm_update_task_settings($1,1,'open',now(),'other@example.com',false,true,60)", [taskId])).rejects.toThrow("Only the task owner");
    await db.exec("rollback to edit_check");
    await expect(db.query("select crm_update_task_settings($1,9,'open',now(),'rep@example.com',false,true,60)", [taskId])).rejects.toThrow("Task changed");
    await db.exec("rollback to edit_check");
  });
  it("rejects stale projections when a record changes during indexing", async () => {
    await addContact("tools:contact-a", "first@example.com");
    const claim = await db.query<{ record_id: string; revision: number; record: object }>("select * from crm_claim_projections($1,100)", [token]);
    await db.exec("update crm_records set properties='{\"email\":\"new@example.com\"}' where id='tools:contact-a'");
    const rows = claim.rows.map(row => ({ record_id: row.record_id, revision: row.revision, ...projectCrmRecord(row.record) }));
    await db.query("select crm_commit_projections($1,$2)", [token, rows]);
    expect((await db.query("select * from crm_identities where record_id='tools:contact-a'")).rows).toHaveLength(0);
    await indexAll();
    expect((await db.query("select value from crm_identities where record_id='tools:contact-a'")).rows).toEqual([{ value: "new@example.com" }]);
  });
  it("flags duplicates without merging and reopens review when membership changes", async () => {
    await addContact("tools:contact-a", "client@example.com"); await addContact("tools:contact-b", "CLIENT@example.com"); await indexAll();
    const group = (await db.query<{ fingerprint: string }>("select * from crm_duplicate_groups()" )).rows[0];
    expect(group).toBeDefined();
    await db.query("select crm_review_duplicate('email','client@example.com',$1,'separate','rep@example.com')", [group.fingerprint]);
    expect((await db.query("select * from crm_duplicate_groups()" )).rows).toHaveLength(0);
    expect((await db.query("select * from crm_duplicate_groups(true)" )).rows).toHaveLength(1);
    expect((await db.query("select count(*)::int n from crm_records where object_type='contacts'" )).rows[0]).toEqual({ n: 2 });
    await addContact("tools:contact-c", "client@example.com"); await indexAll();
    const next = (await db.query<{ fingerprint: string }>("select * from crm_duplicate_groups()" )).rows[0];
    expect(next.fingerprint).not.toBe(group.fingerprint);
  });
  it("indexes file references idempotently, including shared attachments, without modifying source properties", async () => {
    const properties = { hs_attachment_ids: "10;10;20", hs_note_body: "Keep original" };
    for (const id of ["1", "2"]) await db.query("insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,properties) values($1,'notes','hubspot','1',$2,'Note',$3)", [`hubspot:1:notes:${id}`, id, properties]);
    await indexAll();
    expect((await db.query("select count(*)::int n from crm_assets")).rows[0]).toEqual({ n: 2 });
    expect((await db.query("select count(*)::int n from crm_record_assets")).rows[0]).toEqual({ n: 4 });
    expect((await db.query("select properties from crm_records where id='hubspot:1:notes:1'")).rows[0]).toEqual({ properties });
    const claim = await db.query<{ id: string }>("select * from crm_claim_assets($1,1)", [token]);
    expect(claim.rows).toHaveLength(1);
    expect((await db.query("select * from crm_claim_assets($1,5)", [otherToken])).rows).toHaveLength(1);
    expect((await db.query("select crm_finish_asset($1,$2,'{\"status\":\"blocked\",\"error_code\":\"hubspot_file_access\"}') saved", [claim.rows[0].id, otherToken])).rows[0]).toEqual({ saved: false });
  });
  it("captures a source event once and preserves the complete original source record", async () => {
    await addContact("tools:contact-a", "client@example.com"); await indexAll();
    const event = await enqueueEmail();
    const result = { status: "captured", contact_id: "tools:contact-a", title: "Email", summary: "Preview", body: "Preview only" };
    await db.query("select crm_finish_capture($1,$2,$3,$4)", [event.id, token, event.revision, result]);
    await db.exec("update email_messages set snippet=snippet where message_id='m1'");
    expect((await db.query("select * from crm_claim_capture($1,20)", [otherToken])).rows).toHaveLength(0);
    expect((await db.query("select count(*)::int n from crm_records where object_type='emails'")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("select snippet from email_messages where message_id='m1'")).rows[0]).toEqual({ snippet: "Preview" });
    expect((await db.query("select count(*)::int n from crm_related_records('tools:contact-a')")).rows[0]).toEqual({ n: 1 });
  });
  it("waits for contact indexing before matching new activity", async () => {
    await addContact("tools:contact-a", "client@example.com");
    expect(await enqueueEmail()).toBeUndefined();
    await indexAll();
    expect((await db.query("select * from crm_claim_capture($1,20)", [otherToken])).rows).toHaveLength(1);
  });
  it("ignores old and nonbusiness mailbox events at intake", async () => {
    await db.exec("insert into email_messages(message_id,thread_id,store_id,inbox,direction,received_at) values('old','t','rf_transparent','info@glass-railing.com','inbound',now()-interval '1 year'),('private','t','rf_transparent','private@example.com','inbound',now())");
    expect((await db.query("select * from crm_capture_events")).rows).toHaveLength(0);
  });
  it("keeps ambiguous events for review and rejects stale review decisions", async () => {
    await indexAll(); const event = await enqueueEmail();
    await db.query("select crm_finish_capture($1,$2,$3,'{\"status\":\"review\",\"reason\":\"no_customer_match\"}')", [event.id, token, event.revision]);
    await addContact("tools:contact-a", "client@example.com");
    await db.exec("savepoint review_check");
    await expect(db.query("select crm_finish_capture($1,null,999,$2,'rep@example.com')", [event.id, { status: "captured", contact_id: "tools:contact-a" }])).rejects.toThrow("Activity changed");
    await db.exec("rollback to review_check");
    await db.query("select crm_finish_capture($1,null,$2,$3,'rep@example.com')", [event.id, event.revision, { status: "captured", contact_id: "tools:contact-a", title: "Reviewed email", summary: "", body: "" }]);
    expect((await db.query("select reviewed_by,status from crm_capture_events")).rows[0]).toEqual({ reviewed_by: "rep@example.com", status: "captured" });
  });
});

it("keeps contact edits separate from the source and reindexes the edited identity", async () => {
  const id = "tools:contact-edit";
  await addContact(id, "original@example.com"); await indexAll();
  const original = (await db.query("select properties,property_history,title from crm_records where id=$1", [id])).rows[0];
  const fields = { title: "Updated customer", email: "current@example.com", phone: "4165550199", company: "Current company", stage: "customer" };
  await db.query("select crm_edit_contact($1,1,$2,'rep@example.com')", [id, fields]);
  expect((await db.query("select properties,property_history,title from crm_records where id=$1", [id])).rows[0]).toEqual(original);
  await indexAll();
  expect((await db.query("select value from crm_identities where record_id=$1 and kind='email'", [id])).rows).toEqual([{ value: "current@example.com" }]);
  expect((await db.query("select local_fields,version from crm_records where id=$1", [id])).rows[0]).toEqual({ local_fields: fields, version: 2 });
  await db.exec("savepoint contact_version");
  await expect(db.query("select crm_edit_contact($1,1,$2,'rep@example.com')", [id, fields])).rejects.toThrow("Contact changed");
  await db.exec("rollback to contact_version");
  expect((await db.query("select has_function_privilege('authenticated','crm_edit_contact(text,integer,jsonb,text)','execute') allowed")).rows[0]).toEqual({ allowed: false });
  await db.query("update crm_records set properties=$2 where id=$1", [id, { email: "refreshed@example.com" }]); await indexAll();
  expect((await db.query("select local_fields from crm_records where id=$1", [id])).rows[0]).toEqual({ local_fields: fields });
  expect((await db.query("select value from crm_identities where record_id=$1 and kind='email'", [id])).rows).toEqual([{ value: "current@example.com" }]);
});

it("loads timeline summaries without source blobs and retains body search", async () => {
  await addContact("tools:contact-timeline", "client@example.com");
  await db.query("select crm_create_record($1,'notes','Conversation','The zirconium railing requirement','{}',now(),null,'tools:contact-timeline','rep@example.com')", [taskId.slice(6)]);
  const rows = (await db.query<Record<string, unknown>>("select * from crm_related_summaries('tools:contact-timeline','zirconium')")).rows;
  expect(rows).toHaveLength(1); expect(rows[0].title).toBe("Conversation");
  expect(rows[0]).not.toHaveProperty("properties"); expect(rows[0]).not.toHaveProperty("property_history"); expect(rows[0]).not.toHaveProperty("body");
  expect((await db.query("select * from crm_related_summaries('tools:contact-timeline','unmatched')")).rows).toHaveLength(0);
  expect((await db.query("select has_table_privilege('authenticated','crm_record_summaries','select') allowed")).rows[0]).toEqual({ allowed: false });
});
it("prioritizes contact indexing and gives parallel workers distinct leases", async () => {
  await addContact("tools:contact-first", "one@example.com");
  await addContact("tools:contact-second", "two@example.com");
  const a = (await db.query<{ record_id: string }>("select * from crm_claim_projections($1,1)", [token])).rows;
  const b = (await db.query<{ record_id: string }>("select * from crm_claim_projections($1,1)", [otherToken])).rows;
  expect(a[0].record_id).toMatch(/^tools:contact/); expect(b[0].record_id).toMatch(/^tools:contact/);
  expect(a[0].record_id).not.toBe(b[0].record_id);
});
