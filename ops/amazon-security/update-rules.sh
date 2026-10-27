#!/bin/sh
set -eu
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
BASE='/Library/Application Support/RFToolsSecurity'
/opt/homebrew/bin/suricata-update --suricata-conf "$BASE/suricata.yaml" --suricata /opt/homebrew/bin/suricata --data-dir "$BASE/update" --output "$BASE/rules" --no-reload
/bin/launchctl kill SIGUSR2 system/ca.rftransparent.amazon-ids
/usr/bin/touch "$BASE/rules-updated"
/usr/bin/find /var/log/rf-amazon-security -name 'eve-*.json' -mtime +14 -delete
