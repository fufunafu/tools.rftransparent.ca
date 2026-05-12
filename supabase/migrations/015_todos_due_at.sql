-- Optional due date on a task. Null = no schedule, shown only under "All".
-- Tasks with a date roll into Today / Overdue / Upcoming filters.
alter table todos
  add column if not exists due_at date;

create index if not exists idx_todos_due_at
  on todos (due_at)
  where due_at is not null and completed = false;
