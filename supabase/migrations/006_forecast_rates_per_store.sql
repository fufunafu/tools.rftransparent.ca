-- Make forecast MoM rates store-specific.
-- Drop old single-key table and recreate with (store_id, month_index) composite key.

drop table if exists forecast_mom_rates;

create table forecast_mom_rates (
  store_id     text not null,
  month_index  int not null check (month_index >= 0 and month_index <= 11),
  mom_rate     numeric not null,
  updated_at   timestamptz not null default now(),
  primary key (store_id, month_index)
);

-- Seed BC store rates (derived from 3 years of pre-Shopify data)
insert into forecast_mom_rates (store_id, month_index, mom_rate) values
  ('store3', 0,  -0.55),  -- Dec→Jan: -55%
  ('store3', 1,   0.50),  -- Jan→Feb: +50%
  ('store3', 2,   1.00),  -- Feb→Mar: +100%
  ('store3', 3,   2.00),  -- Mar→Apr: +200%
  ('store3', 4,   1.20),  -- Apr→May: +120%
  ('store3', 5,   0.07),  -- May→Jun: +7%
  ('store3', 6,  -0.15),  -- Jun→Jul: -15%
  ('store3', 7,  -0.06),  -- Jul→Aug: -6%
  ('store3', 8,  -0.25),  -- Aug→Sep: -25%
  ('store3', 9,  -0.03),  -- Sep→Oct: -3%
  ('store3', 10, -0.08),  -- Oct→Nov: -8%
  ('store3', 11, -0.45)   -- Nov→Dec: -45%
on conflict (store_id, month_index) do nothing;
