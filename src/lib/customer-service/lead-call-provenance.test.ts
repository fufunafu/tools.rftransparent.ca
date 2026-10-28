import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile("supabase/migrations/023_leads.sql", "utf8"));
  await db.exec("insert into leads(id,source,raw_payload,call_status) values ('11111111-1111-4111-8111-111111111111','website','{}','called');");
  await db.exec(await readFile("supabase/migrations/20261028020000_lead_call_provenance.sql", "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
it("leaves historical statuses unattributed and does not invent call records", async () => {
  const lead = (await db.query("select call_status_source,call_status_changed_by,call_status_changed_at from leads")).rows[0];
  expect(lead).toEqual({ call_status_source: null, call_status_changed_by: null, call_status_changed_at: null });
  expect((await db.query("select * from lead_call_status_history")).rows).toHaveLength(0);
  expect((await db.query("select * from lead_call_attempts")).rows).toHaveLength(0);
});
it("records an employee attribution atomically without recording a fictitious phone call", async () => {
  await db.exec("update leads set call_status='called',call_status_source='manual',call_status_changed_by='employee@example.com',call_status_changed_at=clock_timestamp();");
  const history = (await db.query("select previous_status,new_status,source,actor_email from lead_call_status_history")).rows;
  expect(history).toEqual([{ previous_status: "called", new_status: "called", source: "manual", actor_email: "employee@example.com" }]);
  expect((await db.query("select * from lead_call_attempts")).rows).toHaveLength(0);
  await db.exec("update leads set notes='Unrelated edit';");
  expect((await db.query("select * from lead_call_status_history")).rows).toHaveLength(1);
});
it("clears stale staff attribution when an older writer changes the status", async () => {
  await db.exec("update leads set call_status='no_answer';");
  expect((await db.query("select call_status_source,call_status_changed_by from leads")).rows[0]).toEqual({ call_status_source: "system", call_status_changed_by: null });
  const history = (await db.query("select new_status,source,actor_email from lead_call_status_history where new_status='no_answer'")).rows;
  expect(history).toEqual([{ new_status: "no_answer", source: "system", actor_email: null }]);
});
it("requires an actor for manual attribution and restricts audit-table access", async () => {
  await expect(db.exec("update leads set call_status='called',call_status_source='manual',call_status_changed_by=null,call_status_changed_at=clock_timestamp();")).rejects.toThrow("authenticated employee");
  expect((await db.query("select has_table_privilege('anon','lead_call_status_history','SELECT') as anon, has_table_privilege('authenticated','lead_call_status_history','SELECT') as authenticated")).rows[0]).toEqual({ anon: false, authenticated: false });
});
