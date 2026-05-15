-- Replace the single seed PO with three separate POs matching
-- 'Order Summary May 5 2026'. ETAs: Order1=Jun23, Order2=Jul2, Order3=Jul15.
-- 1 crate = 35 units. Idempotent.

delete from purchasing_orders where po_number = 'PO-SEED-2025-07';

with new_po as (
  insert into purchasing_orders (po_number, status, order_date, eta_date, notes)
  values ('PO-2026-05-01', 'in_transit', date '2026-05-05', date '2026-06-23',
          'Order 1 - most urgent.')
  on conflict (po_number) do update set status = excluded.status, eta_date = excluded.eta_date, notes = excluded.notes
  returning id
)
insert into purchasing_order_items (order_id, product_id, qty_ordered, qty_received, unit_cost_snapshot)
select np.id, pp.id, v.qty_ordered, 0, pp.unit_cost_landed from new_po np
cross join (values
  ('GP40X41.3', 70.0::numeric),
  ('GP40X45.3', 105.0::numeric),
  ('GP40X49.2', 105.0::numeric),
  ('GP40X53.1', 105.0::numeric),
  ('GP40X55.1', 105.0::numeric),
  ('GP40X61', 105.0::numeric),
  ('GP40X63', 105.0::numeric),
  ('GP40X65', 105.0::numeric),
  ('GP40X66.9', 105.0::numeric),
  ('GP40X68.9', 105.0::numeric),
  ('GP40X70.9', 105.0::numeric),
  ('GP40X72.8', 70.0::numeric),
  ('GP46X57.7', 105.0::numeric),
  ('GP46X70.9', 70.0::numeric)
) as v(sku, qty_ordered)
join purchasing_products pp on pp.sku = v.sku
on conflict (order_id, product_id) do update set qty_ordered = excluded.qty_ordered, unit_cost_snapshot = excluded.unit_cost_snapshot;

with new_po as (
  insert into purchasing_orders (po_number, status, order_date, eta_date, notes)
  values ('PO-2026-05-02', 'in_transit', date '2026-05-05', date '2026-07-02',
          'Order 2 - after Order 1, urgent.')
  on conflict (po_number) do update set status = excluded.status, eta_date = excluded.eta_date, notes = excluded.notes
  returning id
)
insert into purchasing_order_items (order_id, product_id, qty_ordered, qty_received, unit_cost_snapshot)
select np.id, pp.id, v.qty_ordered, 0, pp.unit_cost_landed from new_po np
cross join (values
  ('GP34X47.2', 35.0::numeric),
  ('GP34X57.7', 35.0::numeric),
  ('GP34X68.9', 35.0::numeric),
  ('GP40X45.3', 70.0::numeric),
  ('GP40X47.2', 70.0::numeric),
  ('GP40X49.2', 70.0::numeric),
  ('GP40X53.1', 70.0::numeric),
  ('GP40X55.1', 70.0::numeric),
  ('GP40X57.7', 35.0::numeric),
  ('GP40X59.1', 35.0::numeric),
  ('GP40X61', 70.0::numeric),
  ('GP40X63', 70.0::numeric),
  ('GP40X65', 70.0::numeric),
  ('GP40X66.9', 70.0::numeric),
  ('GP40X68.9', 105.0::numeric),
  ('GP40X70.9', 35.0::numeric)
) as v(sku, qty_ordered)
join purchasing_products pp on pp.sku = v.sku
on conflict (order_id, product_id) do update set qty_ordered = excluded.qty_ordered, unit_cost_snapshot = excluded.unit_cost_snapshot;

with new_po as (
  insert into purchasing_orders (po_number, status, order_date, eta_date, notes)
  values ('PO-2026-05-03', 'in_transit', date '2026-05-05', date '2026-07-15',
          'Order 3 - up to 2 weeks after Order 1. ETA placeholder.')
  on conflict (po_number) do update set status = excluded.status, eta_date = excluded.eta_date, notes = excluded.notes
  returning id
)
insert into purchasing_order_items (order_id, product_id, qty_ordered, qty_received, unit_cost_snapshot)
select np.id, pp.id, v.qty_ordered, 0, pp.unit_cost_landed from new_po np
cross join (values
  ('GP34X43.3', 35.0::numeric),
  ('GP34X49.2', 35.0::numeric),
  ('GP34X51.2', 35.0::numeric),
  ('GP34X53.1', 35.0::numeric),
  ('GP34X55.1', 35.0::numeric),
  ('GP34X57.7', 35.0::numeric),
  ('GP34X59.1', 35.0::numeric),
  ('GP34X61', 35.0::numeric),
  ('GP34X65', 35.0::numeric),
  ('GP34X66.9', 35.0::numeric),
  ('GP34X70.9', 35.0::numeric),
  ('GP34X72.8', 70.0::numeric),
  ('GP40X10.9', 18.0::numeric),
  ('GP40X17.7', 18.0::numeric),
  ('GP40X21.7', 18.0::numeric),
  ('GP40X37.4', 70.0::numeric),
  ('GP40X39.4', 70.0::numeric),
  ('GP40X43.3', 70.0::numeric),
  ('GP40X45.3', 105.0::numeric),
  ('GP40X47.2', 70.0::numeric),
  ('GP40X49.2', 70.0::numeric),
  ('GP40X51.2', 105.0::numeric),
  ('GP40X53.1', 35.0::numeric),
  ('GP40X55.1', 70.0::numeric),
  ('GP40X57.7', 175.0::numeric),
  ('GP40X59.1', 105.0::numeric),
  ('GP40X61', 105.0::numeric),
  ('GP40X63', 70.0::numeric),
  ('GP40X65', 105.0::numeric),
  ('GP40X66.9', 70.0::numeric),
  ('GP40X68.9', 35.0::numeric),
  ('GP40X70.9', 35.0::numeric),
  ('GP46X41.3', 35.0::numeric),
  ('GP46X43.3', 35.0::numeric),
  ('GP46X63', 35.0::numeric),
  ('GP46X65', 35.0::numeric)
) as v(sku, qty_ordered)
join purchasing_products pp on pp.sku = v.sku
on conflict (order_id, product_id) do update set qty_ordered = excluded.qty_ordered, unit_cost_snapshot = excluded.unit_cost_snapshot;

