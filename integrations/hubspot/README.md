# HubSpot connection and CRM migration

The Tools CRM lives at `/hubspot-dupe`. Access is limited to management, active sales staff, and active customer-service staff. Navigation, the page, the API, and native links enforce the same access policy. Management can operate the import. Task owners and management can complete and reschedule tasks.

HubSpot is a read-only source. New contacts, companies, deals, tickets, calls, meetings, email logs, notes, and tasks are saved in Tools. Logging an email does not send one. Contacts have a searchable table, named views, and an activity workspace with editable contact details. Tasks have upcoming, today, overdue, and completed views. Optional email reminders notify the task owner before due and once overdue.

## Home workspace

Home is the default CRM screen. It shows the viewer's local-day meetings and tasks, a filterable saved activity feed, recent contacts, overdue follow-ups, and weekly counts of contacts added, calls logged, and emails logged. My work filters by the signed-in owner's email; Team includes all CRM owners. Completed tasks on Home are completed tasks due that day. Weeks begin on Monday in the viewer's time zone, including daylight saving changes.

Home preloads compact database summaries on the server and refreshes every minute. Full email bodies, original fields, and history load only after a record is opened. The feed does not claim email-open tracking or a calendar connection. Existing task forms and record workspaces handle creation, completion, and follow-up. Deals and Tickets are absent from navigation and relationship panels; their imported source records remain preserved. Attachment and recording migration remains available inside the collapsed HubSpot connection settings.

## Connection

Configure `HUBSPOT_ACCESS_TOKEN` with a read-only HubSpot service key and set `HUBSPOT_PORTAL_ID` to the intended account. Keep the token in private server environment variables, never in source control or a public environment variable. A live account-info check prevents importing from a different account.

Approved scopes: `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.tickets.read`, `crm.objects.owners.read`, `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read`, `crm.schemas.tickets.read`, `sales-email-read`, and `files.ui_hidden.read` for private attachment access.

The API connection was tested successfully against all nine core object types and the owners endpoint. No HubSpot records are changed by this integration.

## Database and synchronization

Apply the core CRM migrations in order: `20261027023000_hubspot_crm.sql`, `20261027031500_crm_counts_index.sql`, `20261027032500_crm_live_counts.sql`, and `20261027170000_crm_browse_indexes.sql`. They add `crm_records`, `crm_links`, `crm_metadata`, `crm_audit`, `crm_sync_state`, and `crm_record_counts`, plus indexes and service-role-only RPCs. RLS is enabled and browser roles have no direct table or RPC access. Exact overview counts are maintained in the same transaction as record changes, including archive changes and repeat imports. The core migrations do not alter existing business tables. The workflow migrations described below add capture triggers to existing email and call tables. Apply only these migrations, not unrelated pending migrations in a shared checkout.

For an existing busy CRM, the browse indexes can be created with `CREATE INDEX CONCURRENTLY` outside a transaction before recording the migration. Verify all four new indexes are valid and ready first. The first record page and counts load on the server. Record details load normalized content first, with original fields and history fetched when their sections are opened. The original full-record API remains available without a `view` parameter.

Imported records retain portal/object/record IDs, property values and histories, original timestamps, owners, and available archive status. Tools task overrides are independent columns, so an import cannot undo local completion or rescheduling. Local links are never deleted when refreshing HubSpot links. Native creation is idempotent by request UUID. Task writes use optimistic versions and an audit trail.

`/api/cron/sync-hubspot` requires the existing `CRON_SECRET`. Set `HUBSPOT_SYNC_ENABLED=true` to enable the worker. It runs every five minutes, resumes saved pages, and starts a fresh complete pass 24 hours after the previous pass finishes. A database lease prevents concurrent imports. Timed-out batches are split automatically; the page checkpoint advances only when every record and its links are saved. A restart safely replays partial pages using stable source IDs. The management-only manual action processes a bounded batch. It can be resumed without duplicating records.

Full listing uses cursor pagination, avoiding HubSpot Search's 10,000-result retrieval ceiling. History batches are limited to 50 records, as verified against the live API. Association pagination is followed without trusting external continuation URLs. Rate limits and transient server errors are retried. Incomplete batches fail without advancing the checkpoint. API errors never include raw source response bodies.

## Private backup and initial load

Backups contain customer information. They belong under the ignored `.artifacts/hubspot/` directory, with restricted local permissions. Never commit or deploy that directory.

```sh
node --env-file=.env.local integrations/hubspot/backup.mjs .artifacts/hubspot/2026-10-27
node --env-file=.env.local --env-file=.env.crm-database.local integrations/hubspot/load-backup.mjs .artifacts/hubspot/2026-10-27
```

Both commands resume from checkpoints. The loader requires a completed backup and reconciles active counts after loading. The full raw response remains in the local backup. The database stores properties and history in lossless gzip/base64 envelopes; `storage.mjs` opens both compressed and original plain JSON records. Normalized searchable fields remain normal database columns. No separate transfer endpoint is needed. Do not start a live sync while loading the backup.

## Contact workflows and file migration

Apply `20261027183000_crm_workflows.sql`, `20261027183500_crm_activity_capture.sql`, and `20261027192500_crm_workflow_query_paths.sql` after the core CRM migrations. Back up the CRM first and verify the workflow database tests. The migrations add a projection queue, contact identity index, duplicate review decisions, private asset manifests, reminder delivery receipts, and automatic activity capture. All new tables and functions remain service-role-only.

Contact edits use `local_fields` with optimistic versions and an audit trail. Imports preserve these local overrides, and original properties and history remain intact. Compact `view_fields` keep the contact table and activity previews separate from large source blobs. The projection queue updates searchable email and phone identities after source or local edits. Duplicate review records a decision for the exact group membership and never merges or deletes a customer.

`/api/cron/crm-workflows` uses the existing cron authorization and runs every five minutes. Its independent queues handle reminders, projections, and activity capture. `/api/cron/crm-files` separately copies files with a cross-instance lease, bounded concurrency, and a rate limit below the observed HubSpot account limit. File copies run on the server and do not require a computer to stay open. Existing tasks start with reminders disabled. Newly scheduled tasks can opt in to one reminder before the due time and one when overdue. Delivery rechecks completion, owner, due date, active staff access, and opt-out. Stable provider idempotency keys and durable receipts prevent repeated sends during retries.

Automatic capture reads future entries from the existing business email and call integrations. It does not request new mailbox access or send customer email. Email snippets are explicitly identified as previews. Only an exact, unique contact identity is attached automatically; ambiguous or missing matches wait in Activity review. Staff attribution requires a verified employee. Forwarded call legs are deduplicated using source, store, phone, and a narrow time window. Imported historical activity is retained as imported.

File migration reads approved HubSpot file URLs, validates each redirect, and stores content in the private `crm-attachments` bucket. Downloads are bounded to 50 MB. Each uploaded file is downloaded back and checked for matching size and SHA-256 before it is marked ready. Record downloads require current CRM access and use short-lived signed links. Blocked or missing files remain visible for review and retry.

For the initial resumable backfill, use private environment files:

```sh
node --env-file=.env.local --env-file=.env.crm-database.local integrations/hubspot/workflows.mjs index
node --env-file=.env.local --env-file=.env.crm-database.local integrations/hubspot/workflows.mjs files
```

These CLI modes only index records or copy files. They do not send reminders or capture activity. The background worker continues unfinished queues after deployment.

## Migration coverage

Core coverage includes contacts, companies, deals, tickets, calls, meetings, emails, notes, tasks, owners, property definitions, and deal/ticket pipelines. The loader reconciles active counts against the completed backup. Keep account-specific record counts and verification output in the ignored private artifacts directory.

This is **not yet a complete HubSpot account migration**. Attachment and recording copies are tracked separately in Files & recordings. Check that copies have completed and resolve blocked sources before retiring HubSpot. Custom objects, marketing assets, forms, lists, workflows, inbox conversations, sensitive properties requiring extra scopes, and permanently deleted records are not covered. HubSpot does not expose archived meetings through this API. Reconcile these gaps, file accessibility, business processes, and ongoing record counts before cancelling HubSpot.

## Release and recovery

Use the production-preservation procedure in `docs/release-preservation.md`. Prepare an isolated candidate from the latest production source, preserve the guarded sales features, and add only reviewed CRM changes. Never deploy the entire shared checkout.

To pause incoming updates, set `HUBSPOT_SYNC_ENABLED=false`. Keep the CRM tables, audit history, source backups, and Tools-only entries. Disabling or revoking the HubSpot key does not remove imported records. Do not roll back the application or drop CRM tables to recover one feature.

API references: [Service keys](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys), [CRM objects](https://developers.hubspot.com/docs/api-reference/legacy/crm/using-object-apis), [Properties](https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/guide).
