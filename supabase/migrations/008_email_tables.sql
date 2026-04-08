-- Retroactive migration: create email tables that were created manually in the DB.
-- Uses IF NOT EXISTS so this is safe to run even if tables already exist.

create table if not exists email_messages (
  message_id  text not null,
  thread_id   text not null,
  store_id    text not null,
  inbox       text not null,
  direction   text not null check (direction in ('inbound', 'outbound')),
  from_email  text not null default '',
  to_email    text not null default '',
  subject     text not null default '',
  received_at timestamptz not null,
  snippet     text not null default '',
  primary key (message_id, inbox)
);

create index if not exists idx_email_messages_store_received on email_messages (store_id, received_at desc);
create index if not exists idx_email_messages_thread on email_messages (thread_id);

create table if not exists email_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  inbox           text not null,
  started_at      timestamptz not null default now(),
  status          text not null check (status in ('running', 'success', 'error')),
  finished_at     timestamptz,
  messages_synced integer,
  error_message   text
);

create index if not exists idx_email_sync_runs_inbox on email_sync_runs (inbox, started_at desc);
