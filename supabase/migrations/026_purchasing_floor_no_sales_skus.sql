-- Give specific SKUs a tiny non-zero monthly sales figure so they don't
-- show as "No sales data". Daily = monthly / 30, so 0.3 monthly → 0.01 daily.
--
-- Renumbered from 025. Safe to re-run.

update purchasing_products
   set avg_monthly_sales_grs = 0.3
 where sku = 'GP46X9.8'
   and (avg_monthly_sales_grs + avg_monthly_sales_rf) = 0;
