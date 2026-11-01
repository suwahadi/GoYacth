#!/bin/sh
# Runs backup.sh once a day at 02:30 Asia/Makassar (18:30 UTC). A plain loop is used instead of
# cron so the container runs as an unprivileged user.
set -eu
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) 18:30:00" +%s 2>/dev/null || date -u -D "%Y-%m-%d %H:%M:%S" -d "$(date -u +%Y-%m-%d) 18:30:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  /usr/local/bin/backup.sh || echo "backup failed" >&2
done
