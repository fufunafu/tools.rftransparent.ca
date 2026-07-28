-- Performance: indexes for hot query patterns + a general server cache table.
-- Apply by hand in the Supabase SQL editor (db push is blocked here).
-- Everything is idempotent (if not exists) and safe to re-run.
--
-- The app degrades gracefully without this migration: the routes still work,
-- just without index acceleration or the api_cache read-through. Applying it is
-- a pure speedup.

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- call_records drives the customer-service dashboard, the most-filtered table
-- in the app. Queries: store_id + call_start range (+ order), and
-- store_id + direction + from_number IN (...) + call_start bounds.
create index if not exists idx_call_records_store_start
  on call_records (store_id, call_start);
create index if not exists idx_call_records_store_dir_start
  on call_records (store_id, direction, call_start);
create index if not exists idx_call_records_store_source
  on call_records (store_id, source);

-- followup_leads: the follow-up route filters/sorts heavily by
-- shopify_created_at (added bare in migration 008, never indexed).
create index if not exists idx_followup_leads_store_created
  on followup_leads (store_id, shopify_created_at);

-- kpi_entries: metrics route reads employee_id IN (...) + date range.
create index if not exists idx_kpi_entries_emp_date
  on kpi_entries (employee_id, date);

-- ── General server cache ─────────────────────────────────────────────────────
-- Same shape as pipeline_cache, but shared by any route via lib/api-cache.ts.
-- Survives cold starts and is shared across Fluid Compute instances (unlike the
-- per-instance in-memory caches). TTL is enforced in application code.

create table if not exists api_cache (
  cache_key   text primary key,
  result      jsonb not null,
  computed_at timestamptz not null default now()
);
create index if not exists idx_api_cache_computed_at on api_cache (computed_at);
