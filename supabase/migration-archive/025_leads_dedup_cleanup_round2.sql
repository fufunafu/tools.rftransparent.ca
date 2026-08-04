-- Round 2 of duplicate cleanup. Catches cases that 024 missed:
--   1. Rows with no email AND no phone — can't be acted on, pure noise.
--      Going forward the webhook rejects these, so the leftover ones are safe to drop.
--   2. Rows where the email has stray whitespace differences (e.g.
--      "a@x.com" vs "a @x.com") but the same phone — phone-based dedup catches these.
--
-- Safe to re-run.

-- 1. Drop rows that have no usable contact info.
delete from leads
where (email is null or btrim(email) = '')
  and (phone is null or btrim(phone) = '');

-- 2. Dedup by phone alone within 10 minutes, keeping the oldest.
--    This handles same-person submissions where the email differs only by
--    incidental whitespace (which 024's tuple-based partition missed).
with ranked as (
  select
    id,
    submitted_at,
    min(submitted_at) over (
      partition by phone, coalesce(source_detail, '')
    ) as first_at,
    row_number() over (
      partition by phone, coalesce(source_detail, '')
      order by submitted_at
    ) as rn
  from leads
  where phone is not null
)
delete from leads
where id in (
  select id from ranked
  where rn > 1
    and submitted_at - first_at < interval '10 minutes'
);

-- 3. Dedup by whitespace-stripped, lowercased email within 10 minutes.
--    Catches the symmetric case: same email content but typo'd phones.
with ranked as (
  select
    id,
    submitted_at,
    min(submitted_at) over (
      partition by regexp_replace(lower(email), '\s+', '', 'g'), coalesce(source_detail, '')
    ) as first_at,
    row_number() over (
      partition by regexp_replace(lower(email), '\s+', '', 'g'), coalesce(source_detail, '')
      order by submitted_at
    ) as rn
  from leads
  where email is not null
)
delete from leads
where id in (
  select id from ranked
  where rn > 1
    and submitted_at - first_at < interval '10 minutes'
);
