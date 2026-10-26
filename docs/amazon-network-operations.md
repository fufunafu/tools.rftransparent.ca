# Amazon network controls

Installed and verified October 3, 2026 for the initial single-operator Mac and private RF Tools integration. Source copies live in `ops/amazon-security/`. The test receipt is `amazon-network-verification.json`. These controls do not certify every organizational security practice or guarantee Amazon approval.

## Daily operation

Before Amazon work, inspect `/Library/Application Support/RFToolsSecurity/health.json`. `healthy` must be true and `checkedAt` must be within three minutes. The monitor verifies the service, en0 as the default interface, recent events, and rules younger than 72 hours. Check macOS notifications from RF Tools network security and review Vercel Firewall traffic. Fu Gao is the response owner under the adopted incident procedure. Notifications supplement the daily check; macOS notification preferences can suppress display.

The Suricata launch daemon starts at boot and restarts after failure. It monitors this Mac's en0 traffic in non-promiscuous, passive IDS mode. Emerging Threats Open rules update at 09:17 local time and when the updater loads. A successful update reloads the running engine with USR2. Health and notification jobs run every 60 seconds. The updater and health jobs must remain enabled.

Suricata does not decrypt TLS or block traffic inline. It can inspect observable network traffic, protocol metadata, and plaintext. The macOS application firewall and Vercel WAF provide blocking controls. XProtect supplies built-in malware protection. This installation does not claim a dedicated VPC or a managed organization-wide endpoint service.

## Network access changes

Vercel's `RF Amazon restricted network` rule denies `/amazon` and `/api/amazon`, including descendants, unless the request comes from the recorded operator IP. The current source is a shared NAT address, so it is an additional ingress boundary, not device authentication. The application's approved-user, password certification, and MFA gates remain mandatory. Other RF Tools paths are unaffected.

When traveling or changing networks, Amazon pages can return 403 until the rule is updated. Verify the new address in the owned Vercel Firewall traffic dashboard using the dedicated `/api/amazon/__firewall_probe_20261003__` path, then update only the network condition. Preserve other existing rules, test excluded traffic, and restore the verified operator address. Never disable the application authentication gate or broaden the rule to every address to bypass a failed check.

A new network interface or device requires updating monitoring coverage and re-verifying firewall, malware protection, patches, and authentication before access. The health monitor warns when the default interface is not en0. Do not treat an unchanged NAT address as proof of device compliance.

## Logs and response

Local events: `/var/log/rf-amazon-security/eve-YYYY-MM-DD.json`. Service output: `service.log`. Update and health output: `maintenance.log`. Event records include alerts and statistics without stored packet payloads or application metadata. Event logs rotate daily; the daily maintenance job removes files older than 14 days. Administrative access is required to read event logs. The world-readable health summary contains counters and operational state, without secrets or payloads.

Priority 1/2 alerts trigger a local notification. A stopped monitor, unexpected interface, stale events, or stale rules triggers a warning, limited to once per hour. Pause Amazon operations when monitoring is unhealthy. Preserve relevant logs before retention cleanup and follow `amazon-incident-response.md` for suspected compromise.

## Verification and maintenance

- Configuration: `sudo /opt/homebrew/bin/suricata -T -c '/Library/Application Support/RFToolsSecurity/suricata.yaml'`
- Service: `sudo launchctl print system/ca.rftransparent.amazon-ids`
- Manual update: `sudo /bin/sh '/Library/Application Support/RFToolsSecurity/update-rules.sh'`
- Health check: `cat '/Library/Application Support/RFToolsSecurity/health.json'`
- Harmless detection test: request `http://tools.rftransparent.ca/__rf_ids_test_20261003__` and confirm signature 9900001 in the event log. The owned server may redirect; the outbound marker is still observable.

The test observed a live alert on en0, successful rule reload, a healthy status with increasing packet counts, and a notification agent that consumed the test count. Firewall verification temporarily excluded the operator network: Amazon UI/API returned 403, unrelated sales returned its normal login redirect, and restoring the operator network returned the normal unauthenticated API 401.

For removal, first suspend Amazon processing and record the reason. Unload `ca.rftransparent.amazon-ids`, `ca.rftransparent.amazon-ids-updates`, and `ca.rftransparent.amazon-ids-health` from the system launchd domain, and `ca.rftransparent.amazon-ids-notify` from the user's GUI domain. Preserve incident evidence before removing configuration or logs. Removing these controls requires reassessing the profile answers.

## References

- [Suricata quickstart](https://docs.suricata.io/en/latest/quickstart.html)
- [Suricata rule reloads](https://docs.suricata.io/en/suricata-7.0.14/rule-management/rule-reload.html)
- [Vercel WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)
- [Vercel WAF pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing)
