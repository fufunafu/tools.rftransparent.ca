create table if not exists email_dismissed_threads (
  thread_id   text not null,
  inbox       text not null,
  dismissed_at timestamptz not null default now(),
  primary key (thread_id, inbox)
);
