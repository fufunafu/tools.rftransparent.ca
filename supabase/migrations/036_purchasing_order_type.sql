-- Distinguish external China orders from internal Montreal transfers.
-- Both still land in purchasing_orders (same lifecycle: draft → ordered
-- → in_transit → received), but they're conceptually different and
-- need to be filterable.
--
-- 'china'    = main-supplier order (e.g., Allen). Money out, ~90-day lead.
-- 'montreal' = internal stock transfer from the Montreal warehouse.
--              No purchase, fast.
--
-- Default 'china' for new rows; existing rows backfilled to 'china'
-- since up until now all POs in the system represented main-supplier
-- purchases.
--
-- Safe to re-run.

alter table purchasing_orders
  add column if not exists order_type text not null default 'china'
    check (order_type in ('china', 'montreal'));

-- (No backfill statement needed — NOT NULL + DEFAULT 'china' sets
--  existing rows to 'china' atomically.)

create index if not exists idx_purchasing_orders_type
  on purchasing_orders (order_type, status, order_date desc nulls last);
