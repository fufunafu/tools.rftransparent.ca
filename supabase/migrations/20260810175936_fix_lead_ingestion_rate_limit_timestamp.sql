-- Correct the persistent lead rate limiter. The original function used
-- current_time as a PL/pgSQL variable name, which PostgreSQL resolved as the
-- built-in time-with-time-zone expression inside SQL statements.

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
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
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
  values (p_key, v_now, 1, v_now)
  on conflict (key) do update set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then 1
      else limits.request_count + 1
    end,
    updated_at = v_now
  returning window_started_at, request_count
  into v_window_started_at, v_request_count;

  allowed := v_request_count <= p_limit;
  remaining := greatest(p_limit - v_request_count, 0);
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (
      v_window_started_at + make_interval(secs => p_window_seconds) - v_now
    )))::integer
  );

  if random() < 0.01 then
    delete from lead_ingestion_rate_limits
    where updated_at < v_now - interval '1 day';
  end if;

  return next;
end;
$$;

revoke all on function consume_lead_ingestion_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function consume_lead_ingestion_rate_limit(text, integer, integer)
  to service_role;
