import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const id = "00000000-0000-4000-8000-000000000001";
let db: PGlite;
let month: string;
async function ingest(store: string, order: string, qty: number, excluded = false, key = "source") {
  await db.query("select purchasing_sales_ingest($1,$2::jsonb,$3::jsonb)", [store, JSON.stringify([{ order_id: order, ordered_at: `${month}T12:00:00Z`, updated_at: new Date().toISOString(), month, excluded }]), JSON.stringify([{ order_id: order, line_id: "line", source_key: key, quantity: 120, net_quantity: qty }])]);
}
async function baseline() { return (await db.query<{ rf: string; grs: string }>("select avg_monthly_sales_rf::text rf,avg_monthly_sales_grs::text grs from purchasing_products where id=$1", [id])).rows[0]; }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table purchasing_products(id uuid primary key,avg_monthly_sales_rf numeric,avg_monthly_sales_grs numeric);
    insert into purchasing_products values('${id}',99,88);`);
  await db.exec(readFileSync("supabase/migrations/20261027223000_purchasing_sales_history.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261027223100_purchasing_sales_scoped_refresh.sql", "utf8"));
  month = (await db.query<{ month: string }>("select to_char(date_trunc('month',now() at time zone 'America/Toronto')-interval '1 month','YYYY-MM-DD') as month")).rows[0].month;
  await db.query("insert into purchasing_sales_sources(source_key,store_id,title,product_id,method,reason) values('source','store1','Legacy product',$1,'specification','Same specifications')", [id]);
}, 30000);
afterAll(async () => { await db.close(); });
describe("purchasing sales publication", () => {
  it("keeps manual baselines until both stores finish", async () => {
    await ingest("store1", "one", 120);
    expect((await db.query<{ value: boolean }>("select purchasing_sales_publish() value")).rows[0].value).toBe(false);
    expect(Number((await baseline()).rf)).toBe(99);
    await db.exec("update purchasing_sales_state set history_complete=true,last_success_at=now() where store_id='store1'");
    expect((await db.query<{ value: boolean }>("select purchasing_sales_publish() value")).rows[0].value).toBe(false);
  });
  it("includes zero-sale months in the average and excludes cancelled/test orders", async () => {
    await ingest("store1", "cancelled", 100, true);
    await db.exec("update purchasing_sales_state set history_complete=true,last_success_at=now(); select purchasing_sales_publish()");
    expect(Number((await baseline()).rf)).toBe(10);
    expect(Number((await baseline()).grs)).toBe(0);
    expect((await db.query<{ units: string; estimated_units: string }>("select units::text,estimated_units::text from purchasing_sales_monthly")).rows).toEqual([{ units: "120", estimated_units: "120" }]);
  });
  it("replaces edited orders idempotently, reflecting refunds without double counting", async () => {
    await ingest("store1", "one", 60); await ingest("store1", "one", 60);
    await db.exec("select purchasing_sales_publish()");
    expect(Number((await baseline()).rf)).toBe(5);
    expect((await db.query("select * from purchasing_sales_lines where order_id='one'")).rows).toHaveLength(1);
  });
  it("rolls back a bad replacement without deleting the old order lines", async () => {
    await expect(ingest("store1", "one", 12, false, "missing-source")).rejects.toThrow();
    expect((await db.query<{ net_quantity: number }>("select net_quantity from purchasing_sales_lines where order_id='one'")).rows[0].net_quantity).toBe(60);
  });
  it("preserves the last complete snapshot during an incomplete or failed store refresh", async () => {
    await ingest("store1", "one", 24);
    await db.exec("update purchasing_sales_state set window_started_at=now() where store_id='store2'; select purchasing_sales_publish()");
    expect(Number((await baseline()).rf)).toBe(5);
    await db.exec("update purchasing_sales_state set window_started_at=null,last_error='offline' where store_id='store2'; select purchasing_sales_publish()");
    expect(Number((await baseline()).rf)).toBe(5);
    await db.exec("update purchasing_sales_state set last_error=null where store_id='store2'");
  });
  it("records reviewed conversions and applies them to all historical quantities", async () => {
    await db.query("select purchasing_sales_review('source',$1,2,'manager@example.com')", [id]);
    expect(Number((await baseline()).rf)).toBe(4);
    const audit = await db.query<{ actor_email: string }>("select actor_email from purchasing_sales_match_audit");
    expect(audit.rows).toEqual([{ actor_email: "manager@example.com" }]);
    expect((await db.query<{ estimated_units: string }>("select estimated_units::text from purchasing_sales_monthly")).rows[0].estimated_units).toBe("0");
  });
  it("retains the original manual baseline and denies client roles access", async () => {
    expect(Number((await db.query<{ rf: string }>("select avg_monthly_sales_rf::text rf from purchasing_sales_original_baselines")).rows[0].rf)).toBe(99);
    await db.exec("set role authenticated");
    await expect(db.query("select * from purchasing_sales_lines")).rejects.toThrow(/permission denied/);
    await expect(db.query("select purchasing_sales_publish()")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
