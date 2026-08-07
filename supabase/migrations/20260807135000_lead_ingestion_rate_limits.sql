-- Persistent rate limiting for the public Shopify lead app proxy.

create table if not exists lead_ingestion_rate_limits (
  key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table lead_ingestion_rate_limits enable row level security;
revoke all on table lead_ingestion_rate_limits from public, anon, authenticated;

create or replace function consume_lead_ingestion_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time timestamptz := clock_timestamp();
  current_window timestamptz;
  current_count integer;
begin
  if length(p_key) < 1 or length(p_key) > 200 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_limit > 1000000 then
    raise exception 'invalid rate limit';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit window';
  end if;

  insert into lead_ingestion_rate_limits as limits (
    key,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_key, current_time, 1, current_time)
  on conflict (key) do update set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time
        then current_time
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time
        then 1
      else limits.request_count + 1
    end,
    updated_at = current_time
  returning window_started_at, request_count
  into current_window, current_count;

  allowed := current_count <= p_limit;
  remaining := greatest(p_limit - current_count, 0);
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (
      current_window + make_interval(secs => p_window_seconds) - current_time
    )))::integer
  );

  if random() < 0.01 then
    delete from lead_ingestion_rate_limits
    where updated_at < current_time - interval '1 day';
  end if;

  return next;
end;
$$;

revoke all on function consume_lead_ingestion_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function consume_lead_ingestion_rate_limit(text, integer, integer)
  to service_role;
