import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const user = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key, encrypted_password text, updated_at timestamptz);
    insert into auth.users values ('${user}', 'old-hash', now());`);
  await db.exec(await readFile("supabase/migrations/20261003190000_amazon_security.sql", "utf8"));
}, 30_000);
afterAll(async () => { await db.close(); });

it("does not certify existing passwords and prevents browser roles from reading or certifying records", async () => {
  expect((await db.query("select * from amazon_password_compliance")).rows).toHaveLength(0);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(db.query("select * from public.amazon_password_compliance")).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.confirm_amazon_password('${user}', now())`)).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
});
it("certifies only the exact recent password revision and rejects a replay", async () => {
  await db.exec(`update auth.users set encrypted_password='strong-hash', updated_at='2026-10-03T19:00:01Z' where id='${user}'`);
  await db.exec("set role service_role");
  expect((await db.query<{ ok: boolean }>(`select public.confirm_amazon_password('${user}','2026-10-03T19:00:00Z') as ok`)).rows[0].ok).toBe(false);
  expect((await db.query<{ ok: boolean }>(`select public.confirm_amazon_password('${user}','2026-10-03T19:00:01Z') as ok`)).rows[0].ok).toBe(true);
  expect((await db.query<{ ok: boolean }>(`select public.confirm_amazon_password('${user}','2026-10-03T19:00:01Z') as ok`)).rows[0].ok).toBe(false);
  await db.exec("reset role");
});
it("invalidates certification after a direct reset and does not certify a raced update", async () => {
  await db.exec(`update auth.users set encrypted_password='out-of-band-hash', updated_at='2026-10-03T19:00:02Z' where id='${user}'`);
  expect((await db.query<{ verified_at: string | null }>("select verified_at from amazon_password_compliance")).rows[0].verified_at).toBeNull();
  expect((await db.query<{ ok: boolean }>(`select public.confirm_amazon_password('${user}','2026-10-03T19:00:01Z') as ok`)).rows[0].ok).toBe(false);
  await db.exec("update public.amazon_password_compliance set changed_at=now()-interval '3 minutes'");
  expect((await db.query<{ ok: boolean }>(`select public.confirm_amazon_password('${user}','2026-10-03T19:00:02Z') as ok`)).rows[0].ok).toBe(false);
});
