-- +goose Up
-- Customers may sign in with an email and password as well as Google. The password is chosen on
-- the page the confirmation link opens, so only the owner of the inbox ever sets it.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Google confirms the address it sends, and admins are created by other admins.
UPDATE users SET email_verified_at = COALESCE(last_login_at, created_at) WHERE status <> 'ANONYMIZED';

CREATE TABLE email_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose        TEXT NOT NULL CHECK (purpose IN ('VERIFY', 'RESET')),
    token_hash     BYTEA NOT NULL UNIQUE,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose);

-- One customer account per address, so Google and password sign-ins share their bookings.
CREATE UNIQUE INDEX users_customer_email_idx ON users (lower(email)) WHERE role = 'CUSTOMER' AND status <> 'ANONYMIZED';

-- +goose Down
DROP INDEX users_customer_email_idx;
DROP TABLE email_tokens;
ALTER TABLE users DROP COLUMN email_verified_at;
