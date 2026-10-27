-- Match the UI's explicit NULLS LAST ordering so the first page can stop at
-- 50 records instead of sorting every contact or activity. Keep existing indexes
-- for other queries and installations running an earlier application version.
create index if not exists crm_records_type_recent
  on public.crm_records (object_type, archived, occurred_at desc nulls last, id);
create index if not exists crm_records_recent
  on public.crm_records (archived, occurred_at desc nulls last, id);

-- Substring name/email/phone searches share an OR with full-text search.
-- Index all three alternatives so PostgreSQL can combine their results.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index if not exists crm_records_title_search
  on public.crm_records using gin (title extensions.gin_trgm_ops);
create index if not exists crm_records_summary_search
  on public.crm_records using gin (summary extensions.gin_trgm_ops);
analyze public.crm_records;
