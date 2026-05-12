-- Backfill todos.created_by from display names to authenticated emails by
-- joining the employees table on case-insensitive name match. Anything that
-- doesn't resolve gets bucketed under the owner so no data is lost.
update todos t
set created_by = lower(coalesce(
  (select e.email from employees e
    where lower(e.name) = lower(nullif(trim(t.created_by), ''))
      and e.email is not null
    limit 1),
  'fuannegao25@gmail.com'
));

-- After backfill, created_by must be a non-empty email. Drop the legacy default.
alter table todos alter column created_by set not null;
alter table todos alter column created_by drop default;

-- Per-user list queries need an index.
create index if not exists idx_todos_owner
  on todos (created_by, completed, created_at desc);
