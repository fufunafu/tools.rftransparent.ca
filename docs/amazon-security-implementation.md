# Amazon security implementation

Evidence recorded October 3, 2026. This document records implemented controls, their scope, and remaining operating duties. Amazon approved the resubmitted profile; production application registration remains separate.

## Implemented controls

- Supabase project `slhnhzowvvmspjwzhxvv` now requires 12-character passwords with uppercase, lowercase, digits, and symbols, and rejects known leaked passwords. Settings were saved and verified after reopening. Existing passwords are not retroactively certified.
- Amazon pages and APIs require an administrator account on the explicit approved-user list, defaulting to the RF Tools owner. Each Amazon request checks a verified signed AAL2 session, a currently verified TOTP factor, and a compliant password changed within 365 days.
- `/amazon/security` guides the approved user through authenticator enrollment and password replacement. Password updates require a TOTP verification within five minutes. The user must perform enrollment directly; do not collect their secret or code in chat.
- The live `20261003190000_amazon_security.sql` migration records password-change revisions without retaining passwords or hashes. Only the server can certify a matching, recent revision. Every later password change invalidates the certification, including administrative resets. RLS, function grants, trigger presence, and migration history were verified.
- Password reset and administrative password replacement use the same strength policy. Amazon access remains blocked until the dedicated certification flow completes.
- The initial access device is this Mac, as confirmed by the owner. Its application firewall and stealth mode were verified enabled. XProtect 5363, Gatekeeper, System Integrity Protection, and automatic critical updates were observed enabled/present. Suricata 8.0.7 now runs persistently on en0 with 53,098 enabled Emerging Threats rules, daily updates, one-minute health checks, and local notifications. A harmless live HTTP marker was detected. It operates as passive IDS, without decrypting HTTPS.
- Vercel System Mitigations and two custom WAF rules are active. Amazon UI/API paths are restricted to the initial operator network IP; approved-user and MFA gates still apply. An excluded network returned 403 for both Amazon UI and API while the unrelated sales route remained reachable. After restoring the operator IP, the API reached its normal 401 authentication gate. This is scoped ingress segmentation, not a dedicated VPC. No paid managed rules were enabled. See `amazon-network-verification.json` and `amazon-network-operations.md`.
- Sandbox credentials are stored only in ignored local configuration with mode `0600`. Production SP-API credentials are absent. HTTPS, server-only integration credentials, authorization, same-origin mutations, request-size limits, signed previews, and explicit upload review are implemented.

## Outstanding requirements

- The owner must enroll an authenticator and replace their RF Tools password through the security setup page. No existing account was certified on their behalf.
- Fu Gao adopted `amazon-incident-response.md` on October 3, 2026 and accepted responsibility for six-month reviews and Amazon notification within 24 hours. The next review is due April 3, 2027. Rehearsal remains outstanding. No backup is designated for the initial single-operator rollout; the plan requires a replacement before absence or delegation.
- Keep the monitoring service healthy, respond to endpoint alerts, review Vercel firewall traffic, and verify a new IP before updating the restricted network rule. New devices or interfaces require onboarding. The current shared NAT address is not device identity.
- Account-level MFA for Amazon, Vercel, and Supabase administration, disk encryption, security training, and ongoing log/alert ownership require verification before declaring all organizational practices satisfied.
- Initial profile case 22404325731 was declined. After correcting the assessment of the already-enforced password/MFA gate and implementing/verifying the network controls, the profile was resubmitted with seven Yes answers and Product Listing only. Amazon approved SP-API access in new case 22404482901 at 16:40 EDT on October 3, 2026. Production credentials, real product-type acceptance, and live uploads remain pending. See `amazon-profile-resubmission.json`.

## Release evidence

The release candidate is `/private/tmp/rf-amazon-security-release-20261003`. Its original 837-file baseline was verified against deployment `dpl_HzW9CaKqED6q76YhUoWHuoQZzzyv`. Ten subsequent source changes from deployment `dpl_7cPoKwxGEJxkmpNPW8pG9vvLBWW9` were reconciled with exact source SHA1 matches. Amazon changes are isolated from the shared dirty checkout. All 28 protected sales files remain intact.

The release receipt records final checks and deployment status. Sandbox connectivity was verified separately in `amazon-sandbox-verification.json`; that result does not certify production listing eligibility.
