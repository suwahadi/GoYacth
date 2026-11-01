#!/bin/sh
# Daily backup: PostgreSQL custom-format dump plus a mirror of both S3 buckets, copied to an
# off-site S3-compatible target. Point-in-time recovery is out of scope for v1 (see decisions.md).
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="/backups/db-${stamp}.dump"

export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=SeaweedFS RCLONE_CONFIG_SRC_ENDPOINT="$S3_SOURCE_ENDPOINT" \
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other RCLONE_CONFIG_DST_ENDPOINT="$BACKUP_S3_ENDPOINT" \
  RCLONE_CONFIG_DST_REGION="${BACKUP_S3_REGION:-auto}" RCLONE_CONFIG_DST_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
  RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"

pg_dump --format=custom --no-owner --file="$dump.partial"
mv "$dump.partial" "$dump"
pg_restore --list "$dump" > /dev/null

if [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; then
  rclone copyto "$dump" "dst:${BACKUP_S3_BUCKET}/postgres/$(basename "$dump")"
  for b in $S3_BUCKETS; do
    rclone sync "src:${b}" "dst:${BACKUP_S3_BUCKET}/media/${b}" --fast-list
  done
  rclone delete "dst:${BACKUP_S3_BUCKET}/postgres" --min-age "${BACKUP_RETENTION_DAYS:-30}d"
else
  echo "BACKUP_S3_ACCESS_KEY not set: backup kept on the VPS only" >&2
fi

find /backups -name 'db-*.dump' -mtime +7 -delete
date -u > /backups/last_success
echo "backup ${stamp} complete"
