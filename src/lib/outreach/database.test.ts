import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { normalizeInstantlyEvent, planOutreachEvent, type OutreachConfig, type OutreachEvent } from "./domain";

const config: OutreachConfig = { workspaceId: "11111111-1111-4111-8111-111111111111", campaignIds: { installer_network: "22222222-2222-4222-8222-222222222222", materials_sales: "33333333-3333-4333-8333-333333333333" }, webhookSecret: "x".repeat(40) };
let db: PGlite;
function makeEvent(overrides: Record<string, unknown> = {}): OutreachEvent {
  return normalizeInstantlyEvent({ workspace: config.workspaceId, campaign_id: config.campaignIds.installer_network, timestamp: "2026-09-09T20:00:00Z", event_type: "reply_received", lead_email: "test@example.com", email_id: "reply-1", reply_text: "Please send an installer network application.", ...overrides }, config)!;
}
async function ingest(event: OutreachEvent) { return (await db.query<{ result: { duplicate: boolean; id?: string } }>("select outreach_ingest($1::jsonb) as result", [JSON.stringify(event)])).rows[0].result; }
async function claim() { return (await db.query<{ id: string; lease_token: string; event: OutreachEvent }>("select * from outreach_claim(25)")).rows; }
async function apply(row: Awaited<ReturnType<typeof claim>>[number]) {
  return (await db.query<{ result: string }>("select outreach_apply($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) as result", [row.id,row.lease_token,JSON.stringify(planOutreachEvent(row.event)),JSON.stringify(row.event)])).rows[0].result;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../../../supabase/migrations/20260909210000_outreach_foundation.sql", import.meta.url), "utf8").catch(() => readFile("supabase/migrations/20260909210000_outreach_foundation.sql", "utf8")));
}, 30_000);
beforeEach(async () => { await db.exec("truncate outreach_audit,outreach_tasks,outreach_events,outreach_cases,outreach_contacts cascade;"); });
afterAll(async () => { await db.close(); });

describe("outreach PostgreSQL transactions", () => {
  it("keeps one contact, two independent tracks, and two tasks for overlapping interest", async () => {
    await ingest(makeEvent({ reply_text: "I want to join the installer network. Please send a quote for materials too." }));
    await apply((await claim())[0]);
    expect((await db.query("select * from outreach_contacts")).rows).toHaveLength(1);
    const cases = (await db.query<{ campaign_key: string; provider_campaign_id: string | null }>("select * from outreach_cases order by campaign_key")).rows;
    expect(cases).toHaveLength(2); expect(cases[1].provider_campaign_id).toBeNull();
    expect((await db.query("select * from outreach_tasks where status='open'")).rows).toHaveLength(2);
  });
  it("deduplicates delivery and repeated positive labels without duplicating tasks", async () => {
    const event = makeEvent();
    expect((await ingest(event)).duplicate).toBe(false); expect((await ingest(event)).duplicate).toBe(true);
    await apply((await claim())[0]);
    await ingest(makeEvent({ email_id: "signal-2", event_type: "lead_interested", timestamp: "2026-09-09T20:01:00Z" }));
    await apply((await claim())[0]);
    expect((await db.query("select * from outreach_tasks where status='open'")).rows).toHaveLength(1);
    expect((await db.query("select * from outreach_events")).rows).toHaveLength(2);
  });
  it("stops both tracks immediately when an unsubscribe arrives during processing", async () => {
    await ingest(makeEvent({ reply_text: "I want to join the installer network. Please send a quote." }));
    const pending = (await claim())[0];
    await ingest(makeEvent({ email_id: "stop-2", campaign_id: config.campaignIds.materials_sales, event_type: "lead_unsubscribed" }));
    expect(await apply(pending)).toBe("suppressed");
    expect((await db.query("select * from outreach_tasks where status='open'")).rows).toHaveLength(0);
    expect((await db.query<{ stage: string }>("select stage from outreach_cases")).rows.every((row) => row.stage === "suppressed")).toBe(true);
    await ingest(makeEvent({ email_id: "interest-3", event_type: "lead_interested" }));
    for (const row of await claim()) await apply(row);
    expect((await db.query("select * from outreach_tasks where status='open'")).rows).toHaveLength(0);
  });
  it("cancels existing tasks across both campaigns on suppression", async () => {
    await ingest(makeEvent({ reply_text: "I want to join the installer network. Please send a quote." })); await apply((await claim())[0]);
    await ingest(makeEvent({ email_id: "stop-2", event_type: "lead_unsubscribed", campaign_id: null }));
    expect((await db.query("select * from outreach_tasks where status='open'")).rows).toHaveLength(0);
    expect((await db.query("select * from outreach_tasks where status='cancelled'")).rows).toHaveLength(2);
  });
  it("does not regress newer declines when older events arrive late", async () => {
    await ingest(makeEvent({ email_id: "newer", event_type: "lead_not_interested", timestamp: "2026-09-10T20:00:00Z" })); await apply((await claim())[0]);
    await ingest(makeEvent()); expect(await apply((await claim())[0])).toBe("stale");
    expect((await db.query<{ stage: string }>("select stage from outreach_cases")).rows[0].stage).toBe("declined");
    expect((await db.query("select * from outreach_tasks")).rows).toHaveLength(0);
  });
  it("holds new work during staff takeover and does not replay it on resume", async () => {
    await ingest(makeEvent());
    const id = (await db.query<{ id: string }>("select id from outreach_contacts")).rows[0].id;
    await db.query("select outreach_control($1,'take_over','staff@example.org')",[id]);
    expect(await apply((await claim())[0])).toBe("held");
    await db.query("select outreach_control($1,'resume','staff@example.org')",[id]);
    expect(await claim()).toHaveLength(0);
    expect((await db.query("select * from outreach_audit")).rows).toHaveLength(2);
  });
  it("a stale worker lease cannot apply the event twice", async () => {
    await ingest(makeEvent()); const first = (await claim())[0];
    await db.exec("update outreach_events set locked_until=now()-interval '1 minute'");
    const second = (await claim())[0]; expect(second.lease_token).not.toBe(first.lease_token);
    expect(await apply(first)).toBe("lease_lost"); expect(await apply(second)).toBe("processed");
    expect(await apply(second)).toBe("lease_lost");
  });
  it("records bounded retry failures and makes expired final attempts visible", async () => {
    await ingest(makeEvent()); const first = (await claim())[0];
    await db.query("select outreach_fail($1,$2,'instantly_http_403')",[first.id,first.lease_token]);
    expect(await claim()).toHaveLength(0);
    await db.exec("update outreach_events set status='processing',attempts=5,locked_until=now()-interval '1 minute'");
    expect(await claim()).toHaveLength(0);
    expect((await db.query<{ status: string; error_code: string }>("select status,error_code from outreach_events")).rows[0]).toEqual({ status: "failed", error_code: "lease_expired" });
  });
  it("denies installer/public roles table and RPC access", async () => {
    for (const role of ["anon","authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from outreach_contacts")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from outreach_claim(1)")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await ingest(makeEvent()); expect(await claim()).toHaveLength(1);
    await db.exec("reset role");
  });
  it("requires a completion note and protects tasks from other contacts", async () => {
    await ingest(makeEvent()); await apply((await claim())[0]);
    const contact = (await db.query<{ id: string }>("select id from outreach_contacts")).rows[0];
    const task = (await db.query<{ id: string; event_id: string }>("select id,event_id from outreach_tasks")).rows[0];
    await expect(db.query("select outreach_control($1,'complete_task','staff@example.org',$2,'')",[contact.id,task.id])).rejects.toThrow("Completion note required");
    await db.query("select outreach_control($1,'complete_task','staff@example.org',$2,'Discussed the application and sent the details',$3)",[contact.id,task.id,task.event_id]);
    expect((await db.query<{ status: string }>("select status from outreach_tasks")).rows[0].status).toBe("done");
  });
  it("suppresses on stronger opt-out content in a duplicate delivery", async () => {
    await ingest(makeEvent({ reply_text: "Thanks" })); await apply((await claim())[0]);
    expect((await ingest(makeEvent({ reply_text: "Unsubscribe me and stop emailing me." }))).duplicate).toBe(true);
    expect((await db.query<{ suppressed_at: string | null }>("select suppressed_at from outreach_contacts")).rows[0].suppressed_at).not.toBeNull();
  });
  it("rejects stale task completion after a newer reply updates the task", async () => {
    await ingest(makeEvent()); await apply((await claim())[0]);
    const task = (await db.query<{ id: string; event_id: string; contact_id: string }>("select t.id,t.event_id,c.contact_id from outreach_tasks t join outreach_cases c on c.id=t.case_id")).rows[0];
    await ingest(makeEvent({ email_id: "new-reply", timestamp: "2026-09-09T21:00:00Z" })); await apply((await claim())[0]);
    await expect(db.query("select outreach_control($1,'complete_task','staff@example.org',$2,'Completed previous reply',$3)",[task.contact_id,task.id,task.event_id])).rejects.toThrow("Open task not found");
    expect((await db.query<{ status: string }>("select status from outreach_tasks")).rows[0].status).toBe("open");
  });
  it("only retries failed events and records staff acknowledgement of held events", async () => {
    await ingest(makeEvent()); const first=(await claim())[0];
    const contact=(await db.query<{ id: string }>("select id from outreach_contacts")).rows[0];
    await expect(db.query("select outreach_control($1,'retry_event','staff@example.org',null,'',$2)",[contact.id,first.id])).rejects.toThrow("Failed event not found");
    await db.exec("update outreach_events set status='failed', attempts=5");
    await db.query("select outreach_control($1,'retry_event','staff@example.org',null,'',$2)",[contact.id,first.id]);
    const retry=(await claim())[0]; expect(retry.lease_token).not.toBe(first.lease_token);
    await db.query("select outreach_control($1,'take_over','staff@example.org')",[contact.id]);
    expect(await apply(retry)).toBe("held");
    await expect(db.query("select outreach_control($1,'acknowledge_event','staff@example.org',null,'',$2)",[contact.id,first.id])).rejects.toThrow("Review note required");
    await db.query("select outreach_control($1,'acknowledge_event','staff@example.org',null,'Handled in inbox',$2)",[contact.id,first.id]);
    expect((await db.query<{ status: string }>("select status from outreach_events")).rows[0].status).toBe("processed");
    expect((await db.query("select * from outreach_audit where action in ('retry_event','acknowledge_event')")).rows).toHaveLength(2);
  });
  it("prevents cross-contact task completion and event retry", async () => {
    await ingest(makeEvent()); await apply((await claim())[0]);
    await ingest(makeEvent({ lead_email: "another@example.com", email_id: "another" }));
    const other=(await db.query<{ id: string }>("select id from outreach_contacts where email='another@example.com'")).rows[0];
    const task=(await db.query<{ id: string; event_id: string }>("select id,event_id from outreach_tasks")).rows[0];
    await expect(db.query("select outreach_control($1,'complete_task','staff@example.org',$2,'Attempt other task',$3)",[other.id,task.id,task.event_id])).rejects.toThrow("Open task not found");
    await db.query("update outreach_events set status='failed' where id=$1",[task.event_id]);
    await expect(db.query("select outreach_control($1,'retry_event','staff@example.org',null,'',$2)",[other.id,task.event_id])).rejects.toThrow("Failed event not found");
  });

  it("allows qualified outreach lead sources without modifying existing sources", async () => {
    await db.exec("create table leads(id integer primary key, source text not null check (source in ('website','meta'))); insert into leads values(1,'website'),(2,'meta');");
    await db.exec(await readFile("supabase/migrations/20260909221500_outreach_lead_source.sql", "utf8"));
    await db.exec("insert into leads values(3,'outreach')");
    expect((await db.query<{ source: string }>("select source from leads order by id")).rows.map((r)=>r.source)).toEqual(["website","meta","outreach"]);
    await expect(db.exec("insert into leads values(4,'unknown')")).rejects.toThrow(/check constraint/);
    expect((await db.query<{ convalidated: boolean }>("select convalidated from pg_constraint where conname='leads_source_check'")).rows[0].convalidated).toBe(true);
  });

});
