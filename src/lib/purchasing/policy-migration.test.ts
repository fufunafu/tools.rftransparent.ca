import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { DEFAULT_GLASS_POLICY } from "./policy";
it("adds the glass policy idempotently without changing stock or replacing a revised lead time", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table purchasing_settings(id int primary key, lead_time_days int); insert into purchasing_settings values(1,70),(2,95); create table purchasing_products(id int, current_inventory int); insert into purchasing_products values(1,50);");
    const migration = await readFile(new URL("../../../supabase/migrations/20261028040000_purchasing_glass_policy.sql", import.meta.url), "utf8");
    await db.exec(migration);
    expect((await db.query<{ lead_time_days: number; glass_policy: unknown }>("select lead_time_days,glass_policy from purchasing_settings where id=1")).rows[0]).toEqual({ lead_time_days: 84, glass_policy: DEFAULT_GLASS_POLICY });
    await db.exec("update purchasing_settings set lead_time_days=92 where id=1");
    await db.exec(migration);
    expect((await db.query("select lead_time_days from purchasing_settings order by id")).rows).toEqual([{ lead_time_days: 92 }, { lead_time_days: 95 }]);
    expect((await db.query("select current_inventory from purchasing_products")).rows).toEqual([{ current_inventory: 50 }]);
  } finally { await db.close(); }
});
