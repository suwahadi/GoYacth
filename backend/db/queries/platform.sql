-- name: InsertAuditLog :exec
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, request_id, ip_address)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListAuditLogs :many
SELECT a.*, u.email AS actor_email
FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
WHERE (sqlc.narg(entity_type)::text IS NULL OR a.entity_type = sqlc.narg(entity_type))
  AND (sqlc.narg(entity_id)::text IS NULL OR a.entity_id = sqlc.narg(entity_id))
  AND (sqlc.narg(actor_id)::uuid IS NULL OR a.actor_id = sqlc.narg(actor_id))
  AND (sqlc.narg(action)::text IS NULL OR a.action LIKE sqlc.narg(action) || '%')
  AND (sqlc.narg(actor_email)::text IS NULL OR a.actor_id IN (SELECT id FROM users WHERE lower(email) = lower(sqlc.narg(actor_email))))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR a.created_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR a.created_at < sqlc.narg(to_time))
ORDER BY a.created_at DESC, a.id DESC
LIMIT $1 OFFSET $2;

-- name: CountAuditLogs :one
SELECT count(*) FROM audit_logs a
WHERE (sqlc.narg(entity_type)::text IS NULL OR a.entity_type = sqlc.narg(entity_type))
  AND (sqlc.narg(entity_id)::text IS NULL OR a.entity_id = sqlc.narg(entity_id))
  AND (sqlc.narg(actor_id)::uuid IS NULL OR a.actor_id = sqlc.narg(actor_id))
  AND (sqlc.narg(action)::text IS NULL OR a.action LIKE sqlc.narg(action) || '%')
  AND (sqlc.narg(actor_email)::text IS NULL OR a.actor_id IN (SELECT id FROM users WHERE lower(email) = lower(sqlc.narg(actor_email))))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR a.created_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR a.created_at < sqlc.narg(to_time));

-- name: GetSetting :one
SELECT * FROM settings WHERE key = $1;

-- name: ListSettings :many
SELECT * FROM settings ORDER BY key;

-- name: UpsertSetting :exec
INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();

-- name: InsertIdempotencyKey :one
INSERT INTO idempotency_keys (scope, user_id, key, request_hash)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING
RETURNING id;

-- name: GetIdempotencyKeyForUpdate :one
SELECT * FROM idempotency_keys
WHERE scope = $1 AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(sqlc.narg(user_id)::uuid, '00000000-0000-0000-0000-000000000000'::uuid) AND key = $2
FOR UPDATE;

-- name: CompleteIdempotencyKey :exec
UPDATE idempotency_keys SET status_code = $2, response_body = $3, completed_at = now() WHERE id = $1;

-- name: DeleteIdempotencyKey :exec
DELETE FROM idempotency_keys WHERE id = $1;

-- name: DeleteOldIdempotencyKeys :execrows
DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days';

-- name: InsertMedia :one
INSERT INTO media (bucket, base_name, content_type, uploaded_by, byte_size, delete_after)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetMedia :one
SELECT * FROM media WHERE id = $1;

-- name: ListMediaByIDs :many
SELECT * FROM media WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: MarkMediaReady :exec
UPDATE media SET status = 'READY', width = $2, height = $3, variants = $4, updated_at = now() WHERE id = $1;

-- name: MarkMediaFailed :exec
UPDATE media SET status = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1;

-- name: UpsertMediaTranslation :exec
INSERT INTO media_translations (media_id, locale, alt_text) VALUES ($1, $2, $3)
ON CONFLICT (media_id, locale) DO UPDATE SET alt_text = EXCLUDED.alt_text;

-- name: ListMediaTranslations :many
SELECT * FROM media_translations WHERE media_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: ListMediaUsages :many
SELECT * FROM media_usages WHERE entity_type = $1 AND entity_id = ANY(sqlc.arg(entity_ids)::uuid[]) ORDER BY role, sort_order;

-- name: InsertMediaUsage :exec
INSERT INTO media_usages (media_id, entity_type, entity_id, role, sort_order) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (entity_type, entity_id, role, media_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

-- name: DeleteMediaUsagesForRole :many
DELETE FROM media_usages WHERE entity_type = $1 AND entity_id = $2 AND role = $3 RETURNING media_id;

-- name: DeleteMediaUsagesForEntity :many
DELETE FROM media_usages WHERE entity_type = $1 AND entity_id = $2 RETURNING media_id;

-- name: CountMediaUsages :one
SELECT count(*) FROM media_usages WHERE media_id = $1;

-- name: ClearMediaDeleteAfter :exec
UPDATE media SET delete_after = NULL, updated_at = now() WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: ListOrphanMedia :many
SELECT m.* FROM media m
WHERE m.status <> 'DELETED'
  AND m.created_at < now() - interval '24 hours'
  AND (m.delete_after IS NOT NULL AND m.delete_after < now())
  AND NOT EXISTS (SELECT 1 FROM media_usages u WHERE u.media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.proof_media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.proof_media_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM payouts o WHERE o.proof_media_id = m.id)
ORDER BY m.created_at
LIMIT 200;

-- name: MarkMediaDeleted :exec
UPDATE media SET status = 'DELETED', updated_at = now() WHERE id = $1;

-- name: ListMediaAdmin :many
SELECT * FROM media WHERE status <> 'DELETED' AND bucket = 'PUBLIC' ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: CountMediaAdmin :one
SELECT count(*) FROM media WHERE status <> 'DELETED' AND bucket = 'PUBLIC';

-- name: ScheduleMediaDeletion :exec
UPDATE media SET delete_after = now(), updated_at = now()
WHERE id = ANY(sqlc.arg(ids)::uuid[]) AND NOT EXISTS (SELECT 1 FROM media_usages u WHERE u.media_id = media.id);

-- name: DeleteMediaTranslation :exec
DELETE FROM media_translations WHERE media_id = $1 AND locale = $2;
