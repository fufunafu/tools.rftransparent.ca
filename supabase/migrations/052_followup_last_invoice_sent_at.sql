-- Follow-up: store when a quote's most recent invoice was sent, so Quotes-by-Staff
-- can window by "last worked" rather than "created" (matches last-sender attribution).
-- Backfilled on the next sync; null falls back to shopify_created_at. Safe to re-run.

alter table followup_leads
  add column if not exists last_invoice_sent_at timestamptz;
