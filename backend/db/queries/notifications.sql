-- name: ClaimNotification :one
INSERT INTO notification_logs (kind, dedupe_key, booking_id, user_id, recipient, locale, attempts)
VALUES ($1, $2, $3, $4, $5, $6, 1)
ON CONFLICT (dedupe_key) DO UPDATE SET attempts = notification_logs.attempts + 1, updated_at = now()
WHERE notification_logs.status <> 'SENT'
RETURNING *;

-- name: MarkNotificationSent :exec
UPDATE notification_logs SET status = 'SENT', sent_at = now(), last_error = '', updated_at = now() WHERE id = $1;

-- name: MarkNotificationFailed :exec
UPDATE notification_logs SET status = 'FAILED', last_error = $2, updated_at = now() WHERE id = $1;

-- name: ListActiveAdminEmails :many
SELECT email FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY email;

-- name: ListNotificationLogs :many
SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2;
