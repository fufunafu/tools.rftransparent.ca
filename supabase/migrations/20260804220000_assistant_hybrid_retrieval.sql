-- Provenance, semantic embeddings, hybrid retrieval, and knowledge-gap logging
-- for the WhatsApp employee assistant.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists assistant_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 240),
  source_kind text not null default 'text' check (source_kind in (
    'text',
    'transcript',
    'email',
    'document'
  )),
  content text not null check (char_length(content) between 1 and 120000),
  content_hash text not null check (char_length(content_hash) = 64),
  refinements text[] not null default '{}',
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_knowledge_sources_hash_idx
  on assistant_knowledge_sources (content_hash);

alter table assistant_knowledge_sources enable row level security;

alter table assistant_knowledge
  add column if not exists source_id uuid references assistant_knowledge_sources(id) on delete set null,
  add column if not exists source_excerpt text,
  add column if not exists embedding vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assistant_knowledge_source_excerpt_length'
      and conrelid = 'assistant_knowledge'::regclass
  ) then
    alter table assistant_knowledge
      add constraint assistant_knowledge_source_excerpt_length
      check (source_excerpt is null or char_length(source_excerpt) <= 1000);
  end if;
end $$;

create index if not exists assistant_knowledge_source_idx
  on assistant_knowledge (source_id);

create index if not exists assistant_knowledge_embedding_hnsw_idx
  on assistant_knowledge using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create table if not exists assistant_knowledge_queries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  message text not null check (char_length(message) between 1 and 2000),
  rewritten_query text not null check (char_length(rewritten_query) between 1 and 3000),
  department text,
  location text,
  result_count integer not null check (result_count >= 0),
  top_score real,
  matched boolean not null,
  knowledge_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists assistant_knowledge_queries_gap_idx
  on assistant_knowledge_queries (matched, created_at desc);

create index if not exists assistant_knowledge_queries_employee_idx
  on assistant_knowledge_queries (employee_id, created_at desc)
  where employee_id is not null;

alter table assistant_knowledge_queries enable row level security;

create or replace function search_assistant_knowledge_hybrid(
  query_text text,
  query_embedding vector(1536),
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
  source_id uuid,
  source_title text,
  source_excerpt text,
  rank real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with keyword_matches as materialized (
    select
      knowledge.id,
      row_number() over (
        order by ts_rank_cd(
          knowledge.search_document,
          websearch_to_tsquery('english', query_text)
        ) desc
      ) as position
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
    order by ts_rank_cd(
      knowledge.search_document,
      websearch_to_tsquery('english', query_text)
    ) desc
    limit 40
  ),
  semantic_matches as materialized (
    select
      knowledge.id,
      row_number() over (
        order by knowledge.embedding <=> query_embedding
      ) as position,
      (1 - (knowledge.embedding <=> query_embedding))::real as similarity
    from assistant_knowledge as knowledge
    where knowledge.active
      and knowledge.embedding is not null
      and query_embedding is not null
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
    order by knowledge.embedding <=> query_embedding
    limit 40
  ),
  candidate_ids as (
    select keyword_matches.id from keyword_matches
    union
    select semantic_matches.id
    from semantic_matches
    where semantic_matches.similarity >= 0.35
  )
  select
    knowledge.id,
    knowledge.title,
    knowledge.content,
    knowledge.category,
    knowledge.department,
    knowledge.location,
    knowledge.keywords,
    knowledge.source_id,
    source.title as source_title,
    knowledge.source_excerpt,
    (
      coalesce(0.45 / (60 + keyword_matches.position), 0)
      + coalesce(0.55 / (60 + semantic_matches.position), 0)
      + case when knowledge.department is not null then 0.0005 else 0 end
      + case when knowledge.location is not null then 0.0005 else 0 end
    )::real as rank
  from candidate_ids
  join assistant_knowledge as knowledge on knowledge.id = candidate_ids.id
  left join keyword_matches on keyword_matches.id = knowledge.id
  left join semantic_matches on semantic_matches.id = knowledge.id
  left join assistant_knowledge_sources as source on source.id = knowledge.source_id
  order by rank desc, knowledge.updated_at desc
  limit least(greatest(result_limit, 1), 10);
$$;

revoke all on function search_assistant_knowledge_hybrid(
  text,
  vector,
  text,
  text,
  integer
) from public;

grant execute on function search_assistant_knowledge_hybrid(
  text,
  vector,
  text,
  text,
  integer
) to service_role;
