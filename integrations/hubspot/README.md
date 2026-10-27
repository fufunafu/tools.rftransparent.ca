# HubSpot connection and CRM migration

The Tools CRM lives at `/hubspot-dupe`. Access is limited to management, active sales staff, and active customer-service staff. Navigation, the page, the API, and native links enforce the same access policy. Management can operate the import. Task owners and management can complete and reschedule tasks.

HubSpot is a read-only source. New contacts, companies, deals, tickets, calls, meetings, email logs, notes, and tasks are saved in Tools. Logging an email does not send one. Tasks appear in an upcoming/overdue queue; push, email, and calendar reminders are not part of this implementation.

## Connection

Configure `HUBSPOT_ACCESS_TOKEN` with a read-only HubSpot service key and set `HUBSPOT_PORTAL_ID` to the intended account. Keep the token in private server environment variables, never in source control or a public environment variable. A live account-info check prevents importing from a different account.

Approved scopes: `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.tickets.read`, `crm.objects.owners.read`, `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read`, `crm.schemas.tickets.read`, and `sales-email-read`.

The API connection was tested successfully against all nine core object types and the owners endpoint. No HubSpot records are changed by this integration.

## Database and synchronization

Apply the three CRM migrations in order: `20261027023000_hubspot_crm.sql`, `20261027031500_crm_counts_index.sql`, and `20261027032500_crm_live_counts.sql`. They add `crm_records`, `crm_links`, `crm_metadata`, `crm_audit`, `crm_sync_state`, and `crm_record_counts`, plus indexes and service-role-only RPCs. RLS is enabled and browser roles have no direct table or RPC access. Exact overview counts are maintained in the same transaction as record changes, including archive changes and repeat imports. No existing business table is altered. Apply only these migrations, not unrelated pending migrations in a shared checkout.

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

## Migration coverage

Core coverage includes contacts, companies, deals, tickets, calls, meetings, emails, notes, tasks, owners, property definitions, and deal/ticket pipelines. The loader reconciles active counts against the completed backup. Keep account-specific record counts and verification output in the ignored private artifacts directory.

This is **not yet a complete HubSpot account migration**. File binaries and call recordings are not downloaded. Custom objects, marketing assets, forms, lists, workflows, inbox conversations, sensitive properties requiring extra scopes, and permanently deleted records are not covered. HubSpot does not expose archived meetings through this API. Reconcile these gaps, file accessibility, business processes, and ongoing record counts before cancelling HubSpot.

## Release and recovery

Use the production-preservation procedure in `docs/release-preservation.md`. Prepare an isolated candidate from the latest production source, preserve the guarded sales features, and add only reviewed CRM changes. Never deploy the entire shared checkout.

To pause incoming updates, set `HUBSPOT_SYNC_ENABLED=false`. Keep the CRM tables, audit history, source backups, and Tools-only entries. Disabling or revoking the HubSpot key does not remove imported records. Do not roll back the application or drop CRM tables to recover one feature.

API references: [Service keys](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys), [CRM objects](https://developers.hubspot.com/docs/api-reference/legacy/crm/using-object-apis), [Properties](https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/guide).
