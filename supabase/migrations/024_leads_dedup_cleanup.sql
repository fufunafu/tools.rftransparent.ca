-- Remove duplicate leads created before the webhook had idempotency logic.
-- Groups rows by (lower(email), phone, source_detail); within each group, keeps
-- the oldest row in any 10-minute cluster and deletes the rest. The 10-minute
-- window matches the going-forward webhook dedup policy, so a legitimate
-- re-submission hours later is preserved.
--
-- Safe to re-run.

with ranked as (
  select
    id,
    submitted_at,
    min(submitted_at) over (
      partition by
        coalesce(lower(email), ''),
        coalesce(phone, ''),
        coalesce(source_detail, '')
    ) as first_at,
    row_number() over (
      partition by
        coalesce(lower(email), ''),
        coalesce(phone, ''),
        coalesce(source_detail, '')
      order by submitted_at
    ) as rn
  from leads
)
delete from leads
where id in (
  select id from ranked
  where rn > 1
    and submitted_at - first_at < interval '10 minutes'
);
