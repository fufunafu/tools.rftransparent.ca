-- Enable Row Level Security on every table in the public schema.
--
-- Why: the browser is shipped NEXT_PUBLIC_SUPABASE_ANON_KEY for auth. With RLS
-- off (Postgres default) and Supabase's default grants, that key can hit the
-- REST API and read/write tables holding PII (call_records, followup_leads,
-- leads, employees, expense_reimbursements, email_messages, ...) directly,
-- bypassing every isAuthenticated() check in the app.
--
-- The app never reads data with the anon key — it uses it only for auth session
-- management (proxy.ts, auth/callback, LoginForm). ALL data access goes through
-- the service-role client (lib/supabase.ts), and service_role bypasses RLS.
-- So enabling RLS with NO policies = deny-all for anon/authenticated, zero
-- impact on the app. This is the same pattern migrations 057 and 058 already
-- applied to their two tables; this generalizes it to the rest.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled, and this
-- loops over whatever tables currently exist (including hand-created ones not in
-- these migration files). NOT using FORCE so the table owner / SQL editor is
-- unaffected — only the non-owner anon/authenticated roles are denied.

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Verify after running (should return ZERO rows — every public table has RLS):
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
