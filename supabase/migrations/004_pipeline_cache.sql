-- Cache for expensive pipeline computations (predictions, metrics).
-- Keyed by a string identifier (e.g. store filter + days).
-- TTL enforced in application code; old rows cleaned up periodically.

create table if not exists pipeline_cache (
  cache_key   text primary key,
  result      jsonb not null,
  computed_at timestamptz not null default now()
);

-- Index for TTL cleanup
create index if not exists idx_pipeline_cache_computed_at on pipeline_cache (computed_at);
