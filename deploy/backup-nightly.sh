#!/bin/sh
# Nightly LilithList backup. Install: copy to /etc/cron.daily/lilithlist-backup, chmod +x.
# Pair with an off-site encrypted sync (kept separate from LILITH_SECRET_KEY).
set -e
mkdir -p /var/backups/lilithlist
sqlite3 /var/lib/lilithlist/lilithlist.db ".backup /var/backups/lilithlist/nightly-$(date +%F).db"
# keep 14 days
find /var/backups/lilithlist -name 'nightly-*.db' -mtime +14 -delete
