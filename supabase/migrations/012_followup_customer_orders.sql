-- Lifetime Shopify order count for the customer on the draft.
-- Sourced from Shopify's Customer.numberOfOrders during sync; lets the
-- follow-up table flag truly new customers (count = 0) at a glance.

alter table followup_leads
  add column if not exists customer_orders_count integer;
