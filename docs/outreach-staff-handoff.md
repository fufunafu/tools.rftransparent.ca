# Interested leads and staff follow-up

Prepared October 23, 2026. Implementation is based on verified production deployment `dpl_F9V3wp2Vd6qM1yPzcBGizFaxpd9t`, with the preserved sales source check passing.

The staff page is `/customer-service/outreach/leads`. Authenticated employees can claim a ticket, update its stage, save notes, and schedule its next follow-up. Active tickets require a next action and date. Won, lost, and suppressed tickets have no outstanding follow-up date. Writes use the authenticated employee identity and optimistic versions to reject stale edits.

Instantly's authenticated `lead_interested` event creates one ticket per contact and offer. Replayed events cannot duplicate it. A ticket pauses the older owned reply automation. Replies make active tickets due for review. Explicit opt-outs suppress the contact and cancel tasks. A later Not Interested label closes an active ticket as lost. Initial outreach and post-interest staff follow-ups remain separate workflows.

The restored `/api/webhooks/instantly` endpoint verifies the existing secret, workspace, and configured campaign IDs. The five-minute `/api/cron/process-outreach` worker processes the durable event queue. No automatic customer messages are sent by this release. The currently configured campaign scope is the installer and materials campaigns, IDs `28d634a4-5829-4434-baa2-d8efd47201ec` and `89493e52-73d3-4713-ab2f-2f2a3527b4a3`.

`OUTREACH_MAIL_SYNC_ENABLED=true` enables bounded read-only Gmail synchronization for active tickets. The original Instantly email ID must match workspace, campaign, lead, and thread context. Its RFC Message-ID then identifies the exact message in `info@glassrailingstore.com`. Matching must be unique. The existing Gmail connection is checked against the mailbox profile before reading the conversation. Only prospect messages and general-inbox responses addressed to that prospect are attached. Each Gmail message is persisted once. HTML-only messages and attachments remain available in the original inbox. A failed sync is visible on the ticket. Up to three active tickets are checked per five-minute worker run, oldest checked first.

Deployment configuration: `OUTREACH_WORKER_ENABLED=true`, `OUTREACH_MAIL_SYNC_ENABLED=true`, `OUTREACH_AI_ENABLED=false`, `OUTREACH_REPLY_SENDING_ENABLED=false`. Existing credentials stay server-side. The service does not share Gmail OAuth credentials with Instantly.

Email routing remains a separate provider setting. Instantly currently reports a connection error for the general inbox, while RF Tools' existing Gmail connection passed a profile-read check. Instantly requires the Reply-To inbox to be connected for automatic reply detection and classification. Reply-To is an account-level setting. The four draft campaign senders are shared with other campaigns, including an active Nova Scotia campaign. Do not change them until the requested campaign scope is settled. Both GRS drafts retain stop-on-reply and have not been launched by this work.

The current production source omitted the previous outreach intake and worker despite their database schema still existing. This release restores only the intake dependencies needed for staff lead management. It also separates demo-data configuration from the review proxy's Node crypto dependency to resolve a production-source client bundle build failure without changing proxy authentication behavior.

Validation: additive migration rehearsed against current outreach schema, functions, and data with unchanged existing-data fingerprint. Full application lint, type checking, tests, and production build passed before deployment. Deployment verification receipts record final results separately.

Recovery: set `OUTREACH_WORKER_ENABLED=false` and `OUTREACH_MAIL_SYNC_ENABLED=false` to pause processing. Preserve queued events, suppression, and ticket history. Do not drop the additive tables after real activity. Use a new migration for subsequent database changes.
