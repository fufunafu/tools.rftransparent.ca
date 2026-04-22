-- Attribute each follow-up lead to the staff member who created the draft order.
-- For won leads, this reflects the staff on the resulting order; otherwise,
-- it's parsed from the draft's first event ("X created this draft order.").
-- Requires the Quotation app's read_users scope (see SHOPIFY_QUOTATION_ACCESS_TOKEN_N).

alter table followup_leads
  add column if not exists created_by_staff text;

create index if not exists idx_followup_leads_staff
  on followup_leads (store_id, created_by_staff);
