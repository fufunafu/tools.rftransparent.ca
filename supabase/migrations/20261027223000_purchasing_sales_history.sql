-- Order-line demand history is private and independent from the sales dashboard.
create table public.purchasing_sales_state (
  store_id text primary key check (store_id in ('store1','store2')),
  timezone text not null default 'America/New_York',
  watermark timestamptz,
  window_started_at timestamptz,
  cursor text,
  history_complete boolean not null default false,
  last_success_at timestamptz,
  last_error text
);
insert into public.purchasing_sales_state(store_id) values ('store1'),('store2');
create table public.purchasing_sales_lock (
  id boolean primary key default true check (id), token uuid, expires_at timestamptz
);
insert into public.purchasing_sales_lock(id) values(true);
create table public.purchasing_sales_orders (
  store_id text not null references public.purchasing_sales_state(store_id),
  order_id text not null,
  ordered_at timestamptz not null,
  updated_at timestamptz not null,
  month date not null,
  excluded boolean not null,
  primary key(store_id,order_id)
);
create table public.purchasing_sales_sources (
  source_key text primary key,
  store_id text not null references public.purchasing_sales_state(store_id),
  sku text,
  title text not null,
  variant_title text,
  variant_id text,
  product_id uuid references public.purchasing_products(id),
  method text not null check(method in ('sku','specification','review','outside_catalog','approved','excluded')),
  reason text not null,
  unit_multiplier numeric not null default 1 check(unit_multiplier > 0 and unit_multiplier <= 10000),
  reviewed_by text,
  reviewed_at timestamptz,
  check ((product_id is not null) = (method in ('sku','specification','approved')))
);
create table public.purchasing_sales_lines (
  store_id text not null,
  order_id text not null,
  line_id text not null,
  source_key text not null references public.purchasing_sales_sources(source_key),
  quantity integer not null check(quantity >= 0),
  net_quantity integer not null check(net_quantity >= 0),
  primary key(store_id,order_id,line_id),
  foreign key(store_id,order_id) references public.purchasing_sales_orders(store_id,order_id) on delete cascade
);
create index purchasing_sales_lines_source_idx on public.purchasing_sales_lines(source_key);
create index purchasing_sales_orders_month_idx on public.purchasing_sales_orders(month);
create table public.purchasing_sales_monthly (
  product_id uuid not null references public.purchasing_products(id),
  store_id text not null,
  month date not null,
  units numeric not null,
  estimated_units numeric not null,
  primary key(product_id,store_id,month)
);
create table public.purchasing_sales_snapshot (
  id boolean primary key default true check(id),
  refreshed_at timestamptz not null,
  period_start date not null,
  period_end date not null,
  orders_count integer not null,
  review_sources integer not null,
  review_units numeric not null
);
-- Keep the former manual baseline so every change is reversible and auditable.
create table public.purchasing_sales_original_baselines as
select id as product_id, avg_monthly_sales_rf, avg_monthly_sales_grs, now() as captured_at
from public.purchasing_products;
alter table public.purchasing_sales_original_baselines add primary key(product_id);
alter table public.purchasing_products add column sales_updated_at timestamptz;

create function public.purchasing_sales_claim(p_token uuid) returns boolean
language plpgsql set search_path=public as $$
begin
  update purchasing_sales_lock set token=p_token, expires_at=now()+interval '10 minutes'
  where id and (expires_at is null or expires_at < now());
  return found;
end $$;

-- Replace each changed order and all of its lines atomically, including removals.
create function public.purchasing_sales_ingest(p_store text, p_orders jsonb, p_lines jsonb)
returns void language plpgsql set search_path=public as $$
begin
  if p_store not in ('store1','store2') then raise exception 'Invalid store'; end if;
  insert into purchasing_sales_orders(store_id,order_id,ordered_at,updated_at,month,excluded)
  select p_store,x.order_id,x.ordered_at,x.updated_at,x.month,x.excluded
  from jsonb_to_recordset(p_orders) as x(order_id text,ordered_at timestamptz,updated_at timestamptz,month date,excluded boolean)
  on conflict(store_id,order_id) do update set ordered_at=excluded.ordered_at,updated_at=excluded.updated_at,month=excluded.month,excluded=excluded.excluded;
  delete from purchasing_sales_lines where store_id=p_store and order_id in
    (select x->>'order_id' from jsonb_array_elements(p_orders) x);
  insert into purchasing_sales_lines(store_id,order_id,line_id,source_key,quantity,net_quantity)
  select p_store,x.order_id,x.line_id,x.source_key,x.quantity,x.net_quantity
  from jsonb_to_recordset(p_lines) as x(order_id text,line_id text,source_key text,quantity integer,net_quantity integer);
end $$;

create function public.purchasing_sales_publish() returns boolean
language plpgsql set search_path=public as $$
declare start_month date; end_month date;
begin
  perform pg_advisory_xact_lock(hashtext('purchasing_sales_publish'));
  -- A partial import or a failed store must never replace a complete baseline.
  if (select count(*) from purchasing_sales_state where history_complete and window_started_at is null
      and last_success_at > now()-interval '30 minutes' and last_error is null) <> 2 then return false; end if;
  end_month := date_trunc('month',now() at time zone 'America/Toronto')::date;
  start_month := (end_month-interval '12 months')::date;
  delete from purchasing_sales_monthly;
  insert into purchasing_sales_monthly(product_id,store_id,month,units,estimated_units)
  select s.product_id,l.store_id,o.month,sum(l.net_quantity*s.unit_multiplier),
    sum(case when s.method='specification' then l.net_quantity*s.unit_multiplier else 0 end)
  from purchasing_sales_lines l join purchasing_sales_orders o on o.store_id=l.store_id and o.order_id=l.order_id
  join purchasing_sales_sources s using(source_key)
  where not o.excluded and s.product_id is not null
  group by s.product_id,l.store_id,o.month;
  update purchasing_products p set
    avg_monthly_sales_rf=coalesce((select sum(m.units)/12 from purchasing_sales_monthly m where m.product_id=p.id and m.store_id='store1' and m.month>=start_month and m.month<end_month),0),
    avg_monthly_sales_grs=coalesce((select sum(m.units)/12 from purchasing_sales_monthly m where m.product_id=p.id and m.store_id='store2' and m.month>=start_month and m.month<end_month),0),
    sales_updated_at=now()
  where exists(select 1 from purchasing_sales_sources s where s.product_id=p.id);
  -- If a staff correction removes the last match, restore the saved manual baseline.
  update purchasing_products p set avg_monthly_sales_rf=b.avg_monthly_sales_rf,
    avg_monthly_sales_grs=b.avg_monthly_sales_grs,sales_updated_at=null
  from purchasing_sales_original_baselines b where b.product_id=p.id and p.sales_updated_at is not null
    and not exists(select 1 from purchasing_sales_sources s where s.product_id=p.id);
  insert into purchasing_sales_snapshot(id,refreshed_at,period_start,period_end,orders_count,review_sources,review_units)
  select true,now(),start_month,end_month,(select count(*) from purchasing_sales_orders),
    (select count(distinct s.source_key) from purchasing_sales_sources s join purchasing_sales_lines l using(source_key) join purchasing_sales_orders o on o.store_id=l.store_id and o.order_id=l.order_id where s.method='review' and not o.excluded and l.net_quantity>0),
    coalesce((select sum(l.net_quantity) from purchasing_sales_sources s join purchasing_sales_lines l using(source_key) join purchasing_sales_orders o on o.store_id=l.store_id and o.order_id=l.order_id where s.method='review' and not o.excluded),0)
  on conflict(id) do update set refreshed_at=excluded.refreshed_at,period_start=excluded.period_start,period_end=excluded.period_end,orders_count=excluded.orders_count,review_sources=excluded.review_sources,review_units=excluded.review_units;
  return true;
end $$;

create function public.purchasing_sales_source_totals() returns table(source_key text, units bigint, first_month date, last_month date)
language sql stable set search_path=public as $$
  select l.source_key,sum(l.net_quantity)::bigint,min(o.month),max(o.month)
  from purchasing_sales_lines l join purchasing_sales_orders o on o.store_id=l.store_id and o.order_id=l.order_id
  where not o.excluded group by l.source_key
$$;

do $$ declare t text; begin
  foreach t in array array['purchasing_sales_state','purchasing_sales_lock','purchasing_sales_orders','purchasing_sales_sources','purchasing_sales_lines','purchasing_sales_monthly','purchasing_sales_snapshot','purchasing_sales_original_baselines'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
revoke all on function public.purchasing_sales_claim(uuid), public.purchasing_sales_ingest(text,jsonb,jsonb), public.purchasing_sales_publish(), public.purchasing_sales_source_totals() from public, anon, authenticated;
grant execute on function public.purchasing_sales_claim(uuid), public.purchasing_sales_ingest(text,jsonb,jsonb), public.purchasing_sales_publish(), public.purchasing_sales_source_totals() to service_role;

create table public.purchasing_sales_match_audit (
  id bigint generated always as identity primary key,
  source_key text not null references public.purchasing_sales_sources(source_key),
  before_value jsonb not null,
  after_value jsonb not null,
  actor_email text not null,
  created_at timestamptz not null default now()
);
alter table public.purchasing_sales_match_audit enable row level security;
revoke all on public.purchasing_sales_match_audit from anon,authenticated;
grant all on public.purchasing_sales_match_audit to service_role;
grant usage,select on sequence public.purchasing_sales_match_audit_id_seq to service_role;
create function public.purchasing_sales_review(p_source text,p_product uuid,p_multiplier numeric,p_actor text)
returns boolean language plpgsql set search_path=public as $$
declare prior jsonb; updated jsonb;
begin
  select to_jsonb(s) into prior from purchasing_sales_sources s where source_key=p_source for update;
  if prior is null then raise exception 'Source not found'; end if;
  if p_actor is null or length(trim(p_actor))=0 then raise exception 'Reviewer required'; end if;
  update purchasing_sales_sources set product_id=p_product,method=case when p_product is null then 'excluded' else 'approved' end,
    unit_multiplier=p_multiplier,reviewed_by=p_actor,reviewed_at=now(),reason='Reviewed by purchasing staff'
  where source_key=p_source returning to_jsonb(purchasing_sales_sources.*) into updated;
  insert into purchasing_sales_match_audit(source_key,before_value,after_value,actor_email) values(p_source,prior,updated,p_actor);
  return purchasing_sales_publish();
end $$;
revoke all on function public.purchasing_sales_review(text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.purchasing_sales_review(text,uuid,numeric,text) to service_role;
