-- Quotes-by-Staff now attributes each quote to the LAST invoice sender,
-- falling back to created_by_staff when a quote was never invoiced. Mirrors
-- migration 028's cs_followup_by_staff body; only the `staff` grouping changed.
-- Safe to re-run (create or replace).

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
      coalesce(
        nullif(trim(last_invoice_sender), ''),
        nullif(trim(created_by_staff), ''),
        'Unknown'
      ) as staff,
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
