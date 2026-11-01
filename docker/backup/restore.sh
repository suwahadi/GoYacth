#!/bin/sh
# Restore a dump into the configured database. Stop api and worker first.
# Usage: restore.sh /backups/db-20261101T183000Z.dump
#        restore.sh s3:db-20261101T183000Z.dump   (fetch from the off-site bucket)
set -eu
src="${1:?usage: restore.sh <dump file | s3:name>}"
case "$src" in
  s3:*)
    export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other RCLONE_CONFIG_DST_ENDPOINT="$BACKUP_S3_ENDPOINT" \
      RCLONE_CONFIG_DST_REGION="${BACKUP_S3_REGION:-auto}" RCLONE_CONFIG_DST_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
      RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
    name="${src#s3:}"
    rclone copyto "dst:${BACKUP_S3_BUCKET}/postgres/${name}" "/backups/${name}"
    src="/backups/${name}"
    ;;
esac
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$src"
echo "restored $src"
