-- Sales reps earn a commission on the net revenue of orders carrying their
-- Shopify tag (see sales-attribution.ts). The rate is a fraction (0.05 = 5%)
-- so the commission API can multiply directly. Only sales-department
-- employees use it; everyone else keeps the default 0 and never appears in
-- the commissions panel.

alter table employees add column if not exists commission_rate numeric not null default 0;
