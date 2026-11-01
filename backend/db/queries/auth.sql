-- name: GetUserByProvider :one
SELECT * FROM users WHERE provider = $1 AND provider_subject = $2;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: InsertUser :one
INSERT INTO users (provider, provider_subject, email, full_name, avatar_url, role, preferred_locale, last_login_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
RETURNING *;

-- name: UpdateUserLogin :one
UPDATE users
SET email = $2, avatar_url = $3, role = $4, last_login_at = now(), updated_at = now(),
    full_name = CASE WHEN full_name = '' THEN sqlc.arg(full_name)::text ELSE full_name END
WHERE id = $1
RETURNING *;

-- name: InsertSession :one
INSERT INTO sessions (token_hash, user_id, csrf_token, user_agent, ip_address, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetSessionWithUser :one
SELECT sqlc.embed(s), sqlc.embed(u)
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now();

-- name: TouchSession :exec
UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeUserSessions :exec
UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';

-- name: InsertOAuthState :exec
INSERT INTO oauth_states (state, code_verifier, nonce, return_to, expires_at) VALUES ($1, $2, $3, $4, $5);

-- name: ConsumeOAuthState :one
DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING *;

-- name: DeleteExpiredOAuthStates :execrows
DELETE FROM oauth_states WHERE expires_at < now();

-- name: GetPendingAdminInvite :one
SELECT * FROM admin_invites WHERE lower(email) = lower(sqlc.arg(email)::text) AND accepted_at IS NULL;

-- name: AcceptAdminInvite :exec
UPDATE admin_invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1;

-- name: CountActiveAdmins :one
SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE';

-- name: LockActiveAdmins :many
SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE;

-- name: ListAdminInvites :many
SELECT * FROM admin_invites ORDER BY created_at DESC LIMIT 500;

-- name: InsertAdminInvite :one
INSERT INTO admin_invites (email, invited_by) VALUES ($1, $2) RETURNING *;

-- name: DeleteAdminInvite :execrows
DELETE FROM admin_invites WHERE id = $1 AND accepted_at IS NULL;

-- name: InsertBootstrapAdmin :one
INSERT INTO admin_invites (email, invited_by) VALUES ($1, NULL)
ON CONFLICT ((lower(email))) DO UPDATE SET accepted_at = NULL
RETURNING *;

-- name: SetUserRoleByEmail :execrows
UPDATE users SET role = 'ADMIN', updated_at = now() WHERE lower(email) = lower(sqlc.arg(email)::text) AND status = 'ACTIVE';
