-- name: UpdateProfile :one
UPDATE users SET full_name = $2, phone = $3, nationality = $4, preferred_locale = $5, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListUsers :many
SELECT u.*, (SELECT count(*) FROM bookings b WHERE b.user_id = u.id) AS booking_count
FROM users u
WHERE (sqlc.narg(role)::text IS NULL OR u.role = sqlc.narg(role))
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR u.email ILIKE '%' || sqlc.narg(search) || '%' OR u.full_name ILIKE '%' || sqlc.narg(search) || '%')
ORDER BY u.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountUsers :one
SELECT count(*) FROM users u
WHERE (sqlc.narg(role)::text IS NULL OR u.role = sqlc.narg(role))
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR u.email ILIKE '%' || sqlc.narg(search) || '%' OR u.full_name ILIKE '%' || sqlc.narg(search) || '%');

-- name: GetUserForUpdate :one
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: SetUserStatus :one
UPDATE users SET status = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetUserRole :one
UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: AnonymizeUser :exec
UPDATE users SET
    status = 'ANONYMIZED',
    email = 'deleted-' || id::text || '@invalid',
    provider_subject = 'deleted-' || id::text,
    full_name = '', avatar_url = '', phone = '', role = 'CUSTOMER', updated_at = now()
WHERE id = $1;

-- name: AnonymizeUserBookings :exec
UPDATE bookings SET lead_full_name = 'Deleted user', lead_email = 'deleted-' || user_id::text || '@invalid',
    lead_phone = '', special_request = '', updated_at = now()
WHERE user_id = $1;

-- name: AnonymizeUserGuests :exec
UPDATE booking_guests SET full_name = 'Guest', phone = ''
WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = $1);

-- name: PurgeUserIdentities :exec
UPDATE booking_identities SET ciphertext = NULL, key_id = NULL, last4 = '', purged_at = now()
WHERE purged_at IS NULL AND booking_id IN (SELECT id FROM bookings WHERE user_id = $1);

-- name: CountUserOpenBookings :one
SELECT count(*) FROM bookings WHERE user_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS');

-- name: SearchActiveCustomers :many
SELECT * FROM users
WHERE status = 'ACTIVE' AND (email ILIKE '%' || sqlc.arg(search)::text || '%' OR full_name ILIKE '%' || sqlc.arg(search)::text || '%')
ORDER BY email LIMIT 20;
