-- Add Shopify draft order creation date to followup_leads
alter table followup_leads add column if not exists shopify_created_at timestamptz;
