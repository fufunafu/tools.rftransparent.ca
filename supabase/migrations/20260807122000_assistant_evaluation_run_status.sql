-- Distinguish infrastructure errors (network/timeout/HTTP failures while
-- running a check) from genuine content failures in assistant evaluation runs.

alter table assistant_evaluation_runs
  add column if not exists status text not null default 'completed'
    check (status in ('completed', 'error'));
