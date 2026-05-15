-- Customer-service SQL aggregations that were lost in the May 14, 2026 wipe.
-- The cs_followup_summary RPC is owned by migrations 024/025 (and recreated
-- there). This migration defines the other two RPCs:
--   - cs_followup_analytics  (monthly trends)
--   - cs_followup_by_staff   (per-rep breakdown)
--
-- Originally lived in an untracked 014_customer_service_aggregations.sql
-- locally. Renumbered to 028 to avoid colliding with committed migrations.
-- Already applied on Supabase; this file exists so a fresh install runs it.
--
-- Safe to re-run (create or replace).

create or replace function cs_followup_analytics(
  p_store_id text
)
returns table (
  month_key        text,
  total            integer,
  won              integer,
  lost             integer,
  quoted_value     numeric,
  won_value        numeric,
  conversion_rate  numeric
)
language sql
stable
as $$
  with filtered as (
    select
      to_char(coalesce(shopify_created_at, closed_at), 'YYYY-MM') as month_key,
      lead_status,
      quote_amount
    from followup_leads
    where store_id = p_store_id
      and coalesce(shopify_created_at, closed_at) is not null
  )
  select
    f.month_key,
    count(*)::int as total,
    count(*) filter (where f.lead_status = 'won')::int  as won,
    count(*) filter (where f.lead_status = 'lost')::int as lost,
    coalesce(round(sum(f.quote_amount)), 0)::numeric as quoted_value,
    coalesce(round(sum(f.quote_amount) filter (where f.lead_status = 'won')), 0)::numeric as won_value,
    case
      when (count(*) filter (where f.lead_status = 'won')
          + count(*) filter (where f.lead_status = 'lost')) > 0
        then round(
          (count(*) filter (where f.lead_status = 'won')::numeric /
           (count(*) filter (where f.lead_status = 'won')
            + count(*) filter (where f.lead_status = 'lost'))) * 1000
        ) / 10
      else 0
    end as conversion_rate
  from filtered f
  group by f.month_key
  order by f.month_key;
$$;

create or replace function cs_followup_by_staff(
  p_store_id text,
  p_cutoff   timestamptz default null
)
returns table (
  staff            text,
  total            integer,
  won              integer,
  lost             integer,
  active           integer,
  quoted_value     numeric,
  won_value        numeric,
  conversion_rate  numeric
)
language sql
stable
as $$
  with filtered as (
    select
      coalesce(nullif(trim(created_by_staff), ''), 'Unknown') as staff,
      lead_status,
      quote_amount
    from followup_leads
    where store_id = p_store_id
      and shopify_status not in ('OPEN', 'DELETED')
      and (p_cutoff is null or shopify_created_at >= p_cutoff)
  )
  select
    f.staff,
    count(*)::int as total,
    count(*) filter (where f.lead_status = 'won')::int  as won,
    count(*) filter (where f.lead_status = 'lost')::int as lost,
    count(*) filter (where f.lead_status not in ('won', 'lost'))::int as active,
    coalesce(round(sum(f.quote_amount)), 0)::numeric as quoted_value,
    coalesce(round(sum(f.quote_amount) filter (where f.lead_status = 'won')), 0)::numeric as won_value,
    case
      when count(*) > 0
        then round((count(*) filter (where f.lead_status = 'won')::numeric / count(*)) * 1000) / 10
      else 0
    end as conversion_rate
  from filtered f
  group by f.staff
  order by total desc;
$$;
