-- Allow qualified outreach opportunities to retain their acquisition source.
-- This migration does not enroll prospects or create active sales leads.
begin;
set local lock_timeout = '5s';
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('website', 'meta', 'outreach')) not valid;
commit;
-- Validate separately so concurrent reads/writes are not blocked by the scan.
alter table public.leads validate constraint leads_source_check;
