-- Restrict the snapshot replacement explicitly to purchasing catalog products.
-- This is required by the production safe-update guard for service-role calls.
create or replace function public.purchasing_sales_publish() returns boolean
language plpgsql set search_path=public as $$
declare start_month date; end_month date;
begin
  perform pg_advisory_xact_lock(hashtext('purchasing_sales_publish'));
  -- A partial import or a failed store must never replace a complete baseline.
  if (select count(*) from purchasing_sales_state where history_complete and window_started_at is null
      and last_success_at > now()-interval '30 minutes' and last_error is null) <> 2 then return false; end if;
  end_month := date_trunc('month',now() at time zone 'America/Toronto')::date;
  start_month := (end_month-interval '12 months')::date;
  delete from purchasing_sales_monthly where product_id in (select id from purchasing_products);
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
