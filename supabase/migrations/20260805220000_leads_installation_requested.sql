-- Track whether a customer requested installation. Null means that the form
-- did not record an answer, which lets staff identify older leads that need a
-- manual decision.

alter table leads
  add column if not exists installation_requested boolean;

-- Powerful Form Builder serializes its custom button group with [] even
-- though the matching _keyLabel metadata uses the unbracketed field name.
-- Recover every historical Yes/No answer that is already in raw_payload.
update leads
set installation_requested = case
  when lower(trim(coalesce(
    raw_payload -> 'mapped' ->> 'installation_requested',
    raw_payload -> 'mapped' ->> 'installation',
    raw_payload -> 'fields' ->> 'button-1[]',
    raw_payload -> 'fields' ->> 'button-1',
    raw_payload -> 'fields' ->> 'installation_requested',
    raw_payload -> 'fields' ->> 'installation'
  ))) in ('yes', 'true', '1', 'with installation', 'installation required') then true
  when lower(trim(coalesce(
    raw_payload -> 'mapped' ->> 'installation_requested',
    raw_payload -> 'mapped' ->> 'installation',
    raw_payload -> 'fields' ->> 'button-1[]',
    raw_payload -> 'fields' ->> 'button-1',
    raw_payload -> 'fields' ->> 'installation_requested',
    raw_payload -> 'fields' ->> 'installation'
  ))) in ('no', 'false', '0', 'without installation', 'no installation') then false
  else installation_requested
end
where installation_requested is null;

create index if not exists idx_leads_installation_requested
  on leads (submitted_at desc)
  where installation_requested is true;
