-- Approved company knowledge for the WhatsApp employee assistant.
--
-- Knowledge is managed in RF Tools, then retrieved by InvoiceBox through the
-- protected employee-context endpoint. Department and location are optional:
-- null means the entry applies to every employee.

-- PostgreSQL marks array_to_string as stable, which prevents its direct use
-- in a stored generated column. This wrapper is immutable for a fixed text
-- array and delimiter, so the search vector can include administrator-defined
-- synonyms without requiring a trigger.
create or replace function assistant_keywords_text(items text[])
returns text
language sql
immutable
parallel safe
as $$
  select array_to_string(items, ' ');
$$;

create table if not exists assistant_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 8000),
  category text not null check (category in (
    'company',
    'invoices',
    'expenses',
    'time_off',
    'contacts',
    'warehouse',
    'it',
    'hr',
    'other'
  )),
  department text,
  location text,
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', assistant_keywords_text(keywords)), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored
);

create index if not exists assistant_knowledge_search_idx
  on assistant_knowledge using gin (search_document);

create index if not exists assistant_knowledge_scope_idx
  on assistant_knowledge (active, department, location);

alter table assistant_knowledge enable row level security;

-- Human-written test cases and their run history. Keeping runs separate means
-- a regression remains visible after a later successful test.
create table if not exists assistant_evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 1 and 2000),
  expected_answer text not null check (char_length(expected_answer) between 1 and 8000),
  department text,
  location text,
  active boolean not null default true,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_evaluation_cases_active_idx
  on assistant_evaluation_cases (active, updated_at desc);

alter table assistant_evaluation_cases enable row level security;

create table if not exists assistant_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references assistant_evaluation_cases(id) on delete cascade,
  answer text not null,
  passed boolean not null,
  reason text not null,
  model text,
  run_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_evaluation_runs_case_created_idx
  on assistant_evaluation_runs (case_id, created_at desc);

alter table assistant_evaluation_runs enable row level security;

-- Seed only behavior that the current application itself guarantees. Company
-- policies and contacts must be entered by an administrator who can approve
-- their content.
insert into assistant_knowledge (
  id,
  title,
  content,
  category,
  keywords,
  created_by,
  updated_by
)
values
  (
    '00000000-0000-4000-8000-000000000101',
    'Submitting invoices and receipts in WhatsApp',
    'Send a clear invoice or receipt photo or PDF in this WhatsApp chat. Wait for the Saved confirmation, then review the vendor, total, taxes, and payment details shown in the reply. If the confirmation says some fields were unclear, open the supplied InvoiceBox link and correct them.',
    'invoices',
    array['invoice', 'receipt', 'photo', 'pdf', 'submit', 'file', 'filing', 'invoicebox'],
    'system',
    'system'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'Employee assistant knowledge boundary',
    'The WhatsApp employee assistant answers company questions only from active, approved knowledge maintained by administrators in RF Tools. When the approved knowledge does not contain an answer, the assistant says it does not have that information and directs the employee to a manager or the appropriate internal contact.',
    'company',
    array['knowledge', 'know', 'training', 'trained', 'assistant', 'information', 'source'],
    'system',
    'system'
  )
on conflict (id) do nothing;

insert into assistant_evaluation_cases (
  id,
  question,
  expected_answer,
  created_by,
  updated_by
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    'How do I submit an invoice or receipt?',
    'Send a clear photo or PDF in this WhatsApp chat, wait for the Saved confirmation, review the extracted details, and use the InvoiceBox link to correct unclear fields.',
    'system',
    'system'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'What is your knowledge base?',
    'The assistant uses active, approved company knowledge maintained by administrators in RF Tools. If that knowledge does not contain the answer, it directs the employee to a manager or appropriate internal contact.',
    'system',
    'system'
  )
on conflict (id) do nothing;

-- Full-text retrieval with scope enforcement in the database. The service role
-- is the only caller; browser clients receive no direct table or function access.
create or replace function search_assistant_knowledge(
  query_text text,
  employee_department text default null,
  employee_location text default null,
  result_limit integer default 5
)
returns table (
  id uuid,
  title text,
  content text,
  category text,
  department text,
  location text,
  keywords text[],
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    knowledge.id,
    knowledge.title,
    knowledge.content,
    knowledge.category,
    knowledge.department,
    knowledge.location,
    knowledge.keywords,
    (
      ts_rank_cd(
        knowledge.search_document,
        websearch_to_tsquery('english', query_text)
      )
      + case when knowledge.department is not null then 0.05 else 0 end
      + case when knowledge.location is not null then 0.05 else 0 end
    )::real as rank
  from assistant_knowledge as knowledge
  where knowledge.active
    and nullif(btrim(query_text), '') is not null
    and knowledge.search_document @@ websearch_to_tsquery('english', query_text)
    and (
      knowledge.department is null
      or (
        employee_department is not null
        and lower(knowledge.department) = lower(employee_department)
      )
    )
    and (
      knowledge.location is null
      or (
        employee_location is not null
        and lower(knowledge.location) = lower(employee_location)
      )
    )
  order by rank desc, knowledge.updated_at desc
  limit least(greatest(result_limit, 1), 10);
$$;

revoke all on function search_assistant_knowledge(text, text, text, integer) from public;
grant execute on function search_assistant_knowledge(text, text, text, integer) to service_role;
