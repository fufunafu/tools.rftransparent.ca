# Amazon incident response procedure

This procedure covers suspected or confirmed security incidents affecting Glass Railing Store's Amazon information, SP-API credentials, RF Tools, its hosting and authentication services, and devices used to administer the integration. It defines how to contain an incident and notify Amazon without waiting for a completed investigation.

Status: adopted October 3, 2026. Fu Gao explicitly accepted responsibility for six-month reviews and notification to Amazon within 24 hours of detection. The procedure has not yet been rehearsed.

## Responsibility and availability

Fu Gao is the incident coordinator and Amazon notification owner. The contact listed on that profile is fu.gao@mail.mcgill.ca and +1 647 740 4552. Fu is responsible for monitoring these contact channels. The initial rollout has one operator and no designated backup. Before delegating Amazon access or taking an absence that prevents timely response, Fu must designate a replacement and record their contact details here. Any designated engineer assists with containment and evidence collection under the coordinator's direction. A coding assistant is not an on-call responder or a substitute for the responsible person.

Any staff member who suspects exposure must contact the coordinator immediately. When a replacement has been designated, escalate to that person if Fu is unavailable. The notification deadline still applies.

## Routine monitoring

Fu reviews local network security notifications and Vercel Firewall traffic each working day and before Amazon operations. The local health report is `/Library/Application Support/RFToolsSecurity/health.json`; pause Amazon operations if it is unhealthy or stale. Review priority 1/2 Suricata alerts promptly in `/var/log/rf-amazon-security/`. Daily rules update automatically, and local event logs rotate daily and expire after 14 days. Preserve relevant logs immediately when an incident is suspected. See `amazon-network-operations.md` for verification and recovery.

## Detection and initial response

1. Record the first detection time in UTC, reporter, affected systems, symptoms, and the earliest known exposure. Open a private incident record. Preserve the initial evidence and access logs.
2. Within the first hour, determine whether Amazon information or credentials may be affected. Review Amazon portal activity, Vercel request and firewall logs, Supabase authentication logs, repository changes, and endpoint alerts. A credible suspected exposure is enough to initiate notification and containment.
3. Stop affected Amazon processing, revoke or rotate exposed SP-API credentials, remove compromised users from the approved-user list, revoke compromised authentication sessions, and isolate affected devices. Preserve required evidence before destructive remediation whenever practical.
4. Use a known-clean device for investigation and credential rotation. Do not paste secrets, buyer information, or complete request payloads into chat tools, public tickets, source repositories, or ordinary email.

## Amazon notification within 24 hours

The notification owner must report security incidents involving Amazon Information to **security@amazon.com within 24 hours of detection**. The internal target is an initial report within four hours. Do not wait for root-cause certainty, complete scope, a vendor's final report, or management availability. Update the initial report as facts become available.

The initial message must identify 15041074 Canada Inc. / Glass Railing Store, the affected app and seller account identifiers, detection time, known or suspected affected data and systems, containment actions, investigation status, and a monitored response contact. Mark unknown facts as unknown. Do not attach credentials or sensitive data. Follow Amazon's instructions for secure evidence transfer and preserve the sent-message receipt in the private incident record.

No notification is sent merely by creating this procedure. Sending a real incident report is the notification owner's operational duty.

## Recovery and follow-up

Restore service only after the coordinator verifies containment, credential rotation, required patches, access review, and successful security checks. Confirm both that the Amazon integration works and that revoked credentials and removed users cannot access it. Document the cause, impact, timeline, decisions, notifications, corrective actions, and assigned owners. Cooperate with Amazon and the affected providers. Keep incident records access-restricted and apply the company's approved retention policy and any applicable legal hold.

## Reviews and rehearsal

Review this procedure at least once every six months and after every relevant incident or major infrastructure change. Adoption occurred October 3, 2026. The next review is due no later than April 3, 2027.

At each review, confirm primary and backup availability, contact details, Amazon reporting requirements, alert delivery, log availability, account-revocation procedures, and the current inventory of systems and data recipients. Rehearse a leaked SP-API secret and a compromised staff account without exposing a real secret or sending a false incident report. Record participants, elapsed time to escalation and draft notification, observed gaps, and corrective actions.

## Adoption and review record

| Item | Recorded value |
| --- | --- |
| Owner acceptance | Confirmed in conversation: "yes" to incident ownership, six-month reviews, and 24-hour Amazon notification |
| Acceptance date | October 3, 2026 |
| Primary coordinator | Fu Gao |
| Backup coordinator and contact | None designated for initial single-operator rollout; designate before absence or delegation |
| First rehearsal | Not yet performed |
| Next review | April 3, 2027 |

## Related controls

Only approved personnel with a documented Amazon business need may access Amazon information. They must use individual accounts, complete relevant security training, use MFA, and rotate qualifying passwords within 365 days. Remove access immediately when the business need ends. Store credentials only in approved secret storage, keep them out of client bundles and repositories, and use HTTPS for every integration request. Before granting access, verify the device's firewall, malware protection, patch status, and encryption. Maintain the control evidence in `amazon-security-implementation.md`.
