-- Custom (free-text) line items on purchase orders. Use when the user
-- needs to add something to a PO that isn't a tracked SKU — e.g. a
-- one-off rush charge, an ad-hoc box of bolts, or a service line.
--
-- Schema change:
--   - product_id becomes nullable.
--   - new custom_description text column (nullable).
--   - check constraint: at least one of product_id / custom_description set.
--
-- Display logic:
--   - product_id set → existing behavior: pull sku/name from purchasing_products.
--   - custom_description set, product_id null → "Custom" SKU + the description.

alter table purchasing_order_items
  alter column product_id drop not null;

alter table purchasing_order_items
  add column if not exists custom_description text;

alter table purchasing_order_items
  drop constraint if exists purchasing_order_items_product_or_custom;
alter table purchasing_order_items
  add constraint purchasing_order_items_product_or_custom
  check (product_id is not null or custom_description is not null);
