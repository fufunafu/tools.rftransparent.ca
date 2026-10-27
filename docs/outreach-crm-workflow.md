# Outreach lead follow-up

The outreach queue remains separate from website/Meta leads. Interested Instantly replies create tickets; raw prospects do not. Employees can search and filter a client table, record call attempts, log quotes already sent, add dated notes, claim a lead, and schedule the next step.

Calls and quotes use the authenticated employee email, with a display name from the employee directory. The API does not accept a submitted actor identity. Activity records are append-only through the application. The table shows the latest call and latest quote; the detail panel retains every recorded attempt, quote, and note. Historical activity does not replace newer call/quote summary fields. Recording a call does not dial; recording a quote does not generate or send an email. Shared-inbox email sync does not guess which employee sent a quote.

Active call/quote records require a next action and date. Closed leads must be reopened before another call or quote is recorded. Opt-outs remain non-contactable. Version checks reject stale edits, and activity request IDs make retries idempotent. The new tables and RPCs are accessible only to the server service role.

Missing company names, contact names, and phone numbers are imported during inbox sync from a single exact Instantly workspace/campaign/email match. Staff-entered values are not overwritten. Profile lookup failures do not interrupt conversation or opt-out processing.

## Release validation

- Baseline: production deployment `dpl_ERSwXLWv6k6HHPMSoHvDwpqm1VW4`, Git commit `55808faa1632cdb023619a890b6b076fb5a44013`. The feature was reconciled onto this exact production commit, preserving the newer follow-up sync and cron write reductions.
- All 28 protected sales files match the preserved source.
- Lint, TypeScript, 1,274 tests, and the Next.js production build pass.
- Synthetic desktop/mobile browser checks exercise call logging, quote logging, history, and the table. Mobile document overflow was corrected.
- A private public-schema database backup was taken before migration. The new migration was rehearsed locally with 639 contacts, 640 cases, 692 events, two staff leads, two inbox messages, and ten audit entries from that backup. Existing lead values were preserved, and call/quote attribution was verified on the local copy only.
- Migration history was fetched into a separate directory because the shared source includes historical migration discrepancies. The supported Supabase dry run proposes only `20261027020000_outreach_lead_activity.sql`. Do not push unrelated historical migrations or repair history to force a match.

## Recovery

The migration is additive and retains the prior update RPC. If the UI release needs recovery, deploy the previous application source while retaining the added activity data. Do not drop the activity table or new columns after employees have started logging work. Use the private database backup for data recovery only after reviewing changes made since the backup. Do not restore the whole database or roll back unrelated application features for a UI issue.

## Direct Instantly visibility

The lead page now reads Instantly campaign analytics and the current Interested lead list directly through an authenticated server endpoint. Counts remain separate: unique replies, opportunities, current Interested contacts, and current Interested contacts represented in RF Tools. Missing contacts are listed by company and email. Campaign identity and workspace identity are validated; Interested results are paginated and deduplicated. Provider reads are cached for one minute and shared across concurrent requests. A provider or comparison error displays an explicit unavailable state, never a zero count.

This is a read-only provider comparison. It does not run the event worker, change classifications, send messages, or manufacture lead tickets. The pre-existing worker processes five events per five-minute scheduled run. The October 26 investigation confirmed that this caused Interested events to wait behind routine sending events; successful cron status alone does not mean the queue has caught up. The direct panel makes that gap visible independently of worker progress.
