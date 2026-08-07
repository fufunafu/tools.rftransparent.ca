-- Every saved assistant initial prompt, so an edit is recoverable.
-- Service-role only (RLS enabled, no policies), same as settings_audit (062).

create table if not exists assistant_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (char_length(prompt) between 1 and 12000),
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_prompt_versions_created_idx
  on assistant_prompt_versions (created_at desc);

alter table assistant_prompt_versions enable row level security;
