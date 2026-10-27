-- Default Freightcom shipping quote for every Shopify order that needs to
-- ship. One row per (store, order). The cron fills rows in automatically as
-- orders appear; the Logistics > Shipping Quotes page reads them and can ask
-- for a fresh quote.

create table if not exists public.shipping_quotes (
  store_id text not null,
  order_id text not null,                    -- Shopify order gid
  order_name text not null,                  -- e.g. #1234
  order_created_at timestamptz not null,
  customer_name text,
  shipping_method text,                      -- Shopify shippingLine title
  destination jsonb not null,                -- address as sent to Freightcom
  packages jsonb not null,                   -- package list as sent to Freightcom
  weight_source text not null default 'default'
    check (weight_source in ('shopify', 'default')),
  status text not null default 'pending'
    check (status in ('pending', 'quoted', 'no_rates', 'error')),
  rate_request_id text,                      -- Freightcom /rate request_id
  cheapest jsonb,                            -- lowest-total rate
  rates jsonb,                               -- every rate returned
  error text,
  requested_at timestamptz,
  quoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, order_id)
);

create index if not exists shipping_quotes_order_created_idx
  on public.shipping_quotes (order_created_at desc);

create index if not exists shipping_quotes_status_idx
  on public.shipping_quotes (status);
