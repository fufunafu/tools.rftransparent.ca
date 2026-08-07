-- Workflow status for knowledge gaps (assistant_knowledge_queries rows with
-- matched = false). Open gaps show in the settings UI; admins can dismiss them
-- or resolve them by publishing a knowledge answer.

alter table assistant_knowledge_queries
  add column if not exists status text not null default 'open'
    check (status in ('open', 'dismissed', 'resolved')),
  add column if not exists resolved_by text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_knowledge_id uuid
    references assistant_knowledge(id) on delete set null;

create index if not exists assistant_knowledge_queries_open_gap_idx
  on assistant_knowledge_queries (status, created_at desc)
  where matched = false;
