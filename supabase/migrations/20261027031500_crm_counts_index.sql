-- The overview counts should scan compact index entries, not history-bearing rows.
create index if not exists crm_records_active_counts
  on public.crm_records (object_type, source) where not archived;
analyze public.crm_records;
