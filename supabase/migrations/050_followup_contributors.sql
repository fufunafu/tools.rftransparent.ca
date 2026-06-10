-- Follow-up: capture everyone who worked a quote, and switch Quotes-by-Staff
-- attribution to the last person who sent an invoice.
--
--   contributors        — distinct staff who created or invoiced the draft
--                         (parsed from the Shopify event timeline).
--   last_invoice_sender — staff on the most recent "sent an invoice" event;
--                         drives conversion attribution (falls back to
--                         created_by_staff when a quote was never invoiced).
--
-- Existing rows stay null until re-synced; the attribution coalesce below
-- falls back to created_by_staff, so nothing breaks in the meantime.
-- Safe to re-run.

alter table followup_leads
  add column if not exists contributors        jsonb,
  add column if not exists last_invoice_sender  text;
