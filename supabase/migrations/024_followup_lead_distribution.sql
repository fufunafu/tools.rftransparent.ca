-- Extend cs_followup_summary with `lead_distribution`: a full per-status
-- breakdown across active + closed leads, with a synthetic 'pending'
-- bucket for active leads that have never been contacted (followup_count = 0).
-- (Pending bucket is overridden in migration 025; this one keeps it for the
-- intermediate state.)
--
-- Renumbered from 023 because GitHub already had a 023_leads.sql.
-- Safe to re-run.

drop function if exists cs_followup_summary(text, timestamptz);

create or replace function cs_followup_summary(
  p_store_id text,
  p_cutoff   timestamptz default null
)
returns table (
  due_today          integer,
  overdue            integer,
  total_active       integer,
  total_closed       integer,
  won_count          integer,
  lost_count         integer,
  conversion_rate    numeric,
  avg_attempts       numeric,
  avg_cycle_won      numeric,
  avg_cycle_lost     numeric,
  pipeline_value     numeric,
  won_value          numeric,
  by_status          jsonb,
  loss_reasons       jsonb,
  last_synced_at     timestamptz,
  lead_distribution  jsonb
)
language sql
stable
as $$
  with filtered as (
    select *
    from followup_leads
    where store_id = p_store_id
      and shopify_status not in ('OPEN', 'DELETED')
      and (p_cutoff is null or shopify_created_at >= p_cutoff)
  ),
  agg as (
    select
      count(*) filter (
        where closed_at is null
          and next_followup_at >= date_trunc('day', now() at time zone 'UTC')
          and next_followup_at <  date_trunc('day', now() at time zone 'UTC') + interval '1 day'
      )::int as due_today,
      count(*) filter (
        where closed_at is null
          and next_followup_at is not null
          and next_followup_at < date_trunc('day', now() at time zone 'UTC')
      )::int as overdue,
      count(*) filter (where closed_at is null)::int as total_active,
      count(*) filter (where closed_at is not null)::int as total_closed,
      count(*) filter (where lead_status = 'won')::int  as won_count,
      count(*) filter (where lead_status = 'lost')::int as lost_count,
      coalesce(round(sum(quote_amount) filter (where lead_status = 'won')), 0)::numeric as won_value,
      coalesce(round(sum(quote_amount) filter (where closed_at is null)), 0)::numeric as pipeline_value,
      coalesce(
        round(
          avg(followup_count) filter (where closed_at is not null and followup_count > 0),
          1
        ),
        0
      ) as avg_attempts,
      round(
        (avg(extract(epoch from (closed_at - shopify_created_at)) / 86400)
          filter (where lead_status = 'won' and shopify_created_at is not null and closed_at is not null)
        )::numeric,
        1
      ) as avg_cycle_won,
      round(
        (avg(extract(epoch from (closed_at - shopify_created_at)) / 86400)
          filter (where lead_status = 'lost' and shopify_created_at is not null and closed_at is not null)
        )::numeric,
        1
      ) as avg_cycle_lost,
      max(last_synced_at) as last_synced_at
    from filtered
  ),
  by_status_agg as (
    select coalesce(jsonb_object_agg(lead_status, c), '{}'::jsonb) as by_status
    from (
      select lead_status, count(*)::int as c
      from filtered
      where closed_at is null
      group by lead_status
    ) s
  ),
  loss_reasons_agg as (
    select coalesce(jsonb_object_agg(coalesce(close_reason, 'Unknown'), c), '{}'::jsonb) as loss_reasons
    from (
      select close_reason, count(*)::int as c
      from filtered
      where lead_status = 'lost'
      group by close_reason
    ) l
  ),
  lead_distribution_agg as (
    select coalesce(jsonb_object_agg(bucket, c), '{}'::jsonb) as lead_distribution
    from (
      select
        case
          when closed_at is null and coalesce(followup_count, 0) = 0
            then 'pending'
          else lead_status
        end as bucket,
        count(*)::int as c
      from filtered
      group by bucket
    ) d
  )
  select
    a.due_today,
    a.overdue,
    a.total_active,
    a.total_closed,
    a.won_count,
    a.lost_count,
    case
      when (a.won_count + a.lost_count) > 0
        then round((a.won_count::numeric / (a.won_count + a.lost_count)) * 1000) / 10
      else 0
    end as conversion_rate,
    a.avg_attempts,
    a.avg_cycle_won,
    a.avg_cycle_lost,
    a.pipeline_value,
    a.won_value,
    bs.by_status,
    lr.loss_reasons,
    a.last_synced_at,
    ld.lead_distribution
  from agg a, by_status_agg bs, loss_reasons_agg lr, lead_distribution_agg ld;
$$;
