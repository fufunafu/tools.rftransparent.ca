-- Editable seasonal MoM fallback rates for forecast calculations.
-- Used when Shopify data is missing (e.g. pre-migration months).
-- One row per month (0=Jan, 11=Dec), representing the expected MoM growth INTO that month.

create table if not exists forecast_mom_rates (
  month_index  int primary key check (month_index >= 0 and month_index <= 11),
  mom_rate     numeric not null,  -- e.g. 0.50 for +50%, -0.25 for -25%
  updated_at   timestamptz not null default now()
);

-- Seed with initial estimates derived from 3 years of pre-Shopify BC store data
insert into forecast_mom_rates (month_index, mom_rate) values
  (0,  -0.55),  -- Dec→Jan: -55%
  (1,   0.50),  -- Jan→Feb: +50%
  (2,   1.00),  -- Feb→Mar: +100%
  (3,   2.00),  -- Mar→Apr: +200%
  (4,   1.20),  -- Apr→May: +120%
  (5,   0.07),  -- May→Jun: +7%
  (6,  -0.15),  -- Jun→Jul: -15%
  (7,  -0.06),  -- Jul→Aug: -6%
  (8,  -0.25),  -- Aug→Sep: -25%
  (9,  -0.03),  -- Sep→Oct: -3%
  (10, -0.08),  -- Oct→Nov: -8%
  (11, -0.45)   -- Nov→Dec: -45%
on conflict (month_index) do nothing;
