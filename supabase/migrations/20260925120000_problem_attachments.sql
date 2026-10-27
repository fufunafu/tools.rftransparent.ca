-- Pictures for customer problem tickets. Only the server's service-role
-- client accesses rows and bytes; viewing a picture requires a staff session.
create table if not exists public.problem_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.problem_tickets(id) on delete cascade,
  path text not null unique,
  filename text not null,
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
  )),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists problem_attachments_ticket_idx
  on public.problem_attachments(ticket_id, created_at);
alter table public.problem_attachments enable row level security;
revoke all on public.problem_attachments from anon, authenticated;
grant all on public.problem_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'problem-attachments', 'problem-attachments', false, 4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
