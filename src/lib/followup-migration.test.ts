import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("reschedules existing RF quotes and preserves completed outcomes and other stores", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role service_role;");
    await db.exec(await readFile("supabase/migrations/007_followup_crm.sql", "utf8"));
    await db.exec(`
      alter table followup_leads add column shopify_created_at timestamptz;
      alter table followup_leads add column last_invoice_sent_at timestamptz;
      alter table followup_leads add column requoted_at timestamptz;
      insert into followup_leads (
        store_id, shopify_draft_id, draft_name, shopify_status, lead_status,
        followup_count, last_invoice_sent_at, next_followup_at, requoted_at
      ) values
        ('store1', 'first', 'first', 'INVOICE_SENT', 'new', 0, '2026-10-01T12:00Z', '2026-10-04T12:00Z', null),
        ('store1', 'second', 'second', 'INVOICE_SENT', 'no_answer', 1, '2026-10-01T12:00Z', '2026-10-13T12:00Z', null),
        ('store1', 'done', 'done', 'INVOICE_SENT', 'considering', 2, '2026-10-01T12:00Z', '2026-11-01T12:00Z', null),
        ('store1', 'requote', 'requote', 'INVOICE_SENT', 'new', 0, '2026-10-01T12:00Z', '2026-11-01T12:00Z', '2026-10-20T12:00Z'),
        ('store1', 'lost', 'lost', 'INVOICE_SENT', 'lost', 0, '2026-10-01T12:00Z', null, null),
        ('store2', 'other', 'other', 'INVOICE_SENT', 'new', 0, '2026-10-01T12:00Z', '2026-10-04T12:00Z', null);
      insert into followup_logs (lead_id, outcome, logged_by, created_at)
        select id, 'no_answer', 'rep@example.com', '2026-10-12T12:00Z'
        from followup_leads where draft_name = 'second';
      insert into followup_logs (lead_id, outcome, logged_by, created_at)
        select id, 'new', 'system', '2026-10-15T12:00Z'
        from followup_leads where draft_name = 'second';
    `);
    const migration = await readFile("supabase/migrations/20261026120000_rf_two_followups.sql", "utf8");
    await db.exec(migration);
    const read = async () => (await db.query<{ draft_name: string; next_followup_at: Date | null; lead_status: string }>(
      "select draft_name, next_followup_at, lead_status from followup_leads order by draft_name",
    )).rows;
    const rows = await read();
    expect(Object.fromEntries(rows.map((row) => [row.draft_name, row.next_followup_at?.toISOString() ?? null]))).toEqual({
      first: "2026-10-08T12:00:00.000Z",
      second: "2026-11-02T12:00:00.000Z",
      done: null,
      requote: "2026-10-27T12:00:00.000Z",
      lost: null,
      other: "2026-10-04T12:00:00.000Z",
    });
    expect(rows.find((row) => row.draft_name === "done")?.lead_status).toBe("considering");
    await db.exec(migration);
    expect(await read()).toEqual(rows);

    const log = async (name: string, count: number, outcome = "no_answer", actor: string | null = "rep@example.com") => {
      return (await db.query<{ result: { followup_count: number; next_followup_at: string | null; updated_at: string } }>(`
        select log_rf_followup(id, $2, $3, null, $4, null) as result
        from followup_leads where draft_name = $1
      `, [name, count, outcome, actor])).rows[0].result;
    };
    const first = await log("first", 0);
    expect(first.followup_count).toBe(1);
    expect(new Date(first.next_followup_at!).getTime() - new Date(first.updated_at).getTime()).toBe(21 * 86400000);

    // A competing save with the old count cannot add a second history entry.
    await expect(log("first", 0)).rejects.toThrow("This quote changed");
    const second = await log("first", 1, "future_project");
    expect(second.followup_count).toBe(2);
    expect(second.next_followup_at).toBeNull();
    await expect(log("first", 2)).rejects.toThrow("No further follow-ups");
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from followup_logs
      where lead_id = (select id from followup_leads where draft_name = 'first')
    `)).rows[0].count).toBe(2);

    // Closing the quote remains possible without counting a third contact.
    expect((await log("first", 2, "lost")).followup_count).toBe(2);
    await expect(log("other", 0)).rejects.toThrow("Lead not found");

    // If history cannot be written, the count and due date roll back together.
    await expect(log("requote", 0, "no_answer", null)).rejects.toThrow();
    expect((await db.query<{ followup_count: number }>(
      "select followup_count from followup_leads where draft_name = 'requote'",
    )).rows[0].followup_count).toBe(0);
  } finally {
    await db.close();
  }
}, 30_000);
