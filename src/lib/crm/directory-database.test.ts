import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { DirectoryOptions } from "./directory";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const file of ["20261027023000_hubspot_crm.sql", "20261027183000_crm_workflows.sql", "20261027230000_crm_directory_filters.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,owner_email,occurred_at,view_fields,properties,property_history)
    select 'hubspot:test:contacts:'||n,'contacts','hubspot','1',n::text,'Contact '||n,case when n<60 then 'rep@example.com' else null end,
      '2026-01-01'::timestamptz+n*interval '1 day',
      jsonb_build_object('stage',case when n<60 then 'lead' else 'customer' end,'country','Canada','region','Ontario','city',case when n<60 then 'Toronto' else 'Ottawa' end),
      '{"original":"retained"}','{"previous":"retained"}' from generate_series(1,75) n;
    insert into crm_records(id,object_type,source,portal_id,hubspot_id,title,archived,view_fields) values
      ('hubspot:test:contacts:archived','contacts','hubspot','1','archived','Archived',true,'{"stage":"subscriber","country":"United States"}'),
      ('hubspot:test:companies:one','companies','hubspot','1','company','Company',false,'{"stage":"lead","city":"Calgary"}');`);
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });
it("filters the full directory with OR inside a field and AND between fields", async () => {
  const result = await db.query<{ total: number }>(`select count(*)::int total from crm_directory where object_type='contacts' and not archived
    and filter_owner in ('rep@example.com','') and filter_stage in ('lead','customer') and filter_country='canada'
    and filter_region='ontario' and filter_city='ottawa'`);
  expect(result.rows).toEqual([{ total: 16 }]);
  const rows = await db.query("select id from crm_directory where object_type='contacts' and not archived order by occurred_at desc nulls last,id limit 50 offset 50");
  expect(rows.rows).toHaveLength(25);
});
it("builds complete, type-specific filter options beyond the first page and handles empty directories", async () => {
  const read = async (type: string, archived = false) => (await db.query<{ options: DirectoryOptions }>("select crm_directory_filter_options($1,$2) options", [type, archived])).rows[0].options;
  const contacts = await read("contacts");
  expect(contacts.city).toEqual([{ value: "ottawa", label: "Ottawa", count: 16 }, { value: "toronto", label: "Toronto", count: 59 }]);
  expect(contacts.owner.find(option => option.value === "")?.count).toBe(16);
  expect((await read("companies")).city).toEqual([{ value: "calgary", label: "Calgary", count: 1 }]);
  expect((await read("contacts", true)).country).toEqual([{ value: "united states", label: "United States", count: 1 }]);
  expect(await read("companies", true)).toEqual({ owner: [], stage: [], country: [], region: [], city: [] });
});
it("uses edited lifecycle and name immediately, including deliberately cleared stages", async () => {
  await db.exec(`update crm_records set view_fields=view_fields||'{"stage_label":"Original lead"}',local_fields='{"stage":"Customer","title":"  Alpha renamed  "}' where id='hubspot:test:contacts:1';
    update crm_records set local_fields='{"stage":""}' where id='hubspot:test:contacts:2';`);
  const row = (await db.query("select filter_stage,stage_label,directory_name from crm_directory where id='hubspot:test:contacts:1'")).rows[0];
  expect(row).toEqual({ filter_stage: "customer", stage_label: "Customer", directory_name: "alpha renamed" });
  expect((await db.query("select filter_stage from crm_directory where id='hubspot:test:contacts:2'")).rows[0]).toEqual({ filter_stage: "" });
  expect((await db.query("select properties,property_history from crm_records where id='hubspot:test:contacts:1'")).rows[0]).toEqual({ properties: { original: "retained" }, property_history: { previous: "retained" } });
});
it("keeps the directory and options service-only and excludes large source blobs", async () => {
  const columns = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='crm_directory'");
  expect(columns.rows.map(row => row.column_name)).not.toContain("properties");
  expect(columns.rows.map(row => row.column_name)).not.toContain("property_history");
  for (const role of ["anon", "authenticated"]) {
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege($1,'crm_directory','select') allowed", [role])).rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'crm_directory_filter_options(text,boolean)','execute') allowed", [role])).rows[0].allowed).toBe(false);
  }
  await db.exec("set local role service_role");
  expect((await db.query("select id from crm_directory limit 1")).rows).toHaveLength(1);
});
it("rejects unsupported directory option scopes", async () => {
  await expect(db.query("select crm_directory_filter_options('emails',false)")).rejects.toThrow("Invalid directory");
});
