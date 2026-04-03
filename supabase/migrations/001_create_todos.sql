create table if not exists todos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  completed   boolean not null default false,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_todos_completed on todos (completed, created_at desc);
