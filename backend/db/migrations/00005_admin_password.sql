-- +goose Up
-- Admins sign in with email and password; customers keep Google. Admins are created directly by
-- other admins, which replaces the Google allowlist.
ALTER TABLE users
    ADD COLUMN password_hash TEXT NOT NULL DEFAULT '',
    ADD COLUMN failed_logins INT NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
    ADD COLUMN locked_until  TIMESTAMPTZ;

DROP TABLE admin_invites;

-- +goose Down
CREATE TABLE admin_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL,
    invited_by  UUID REFERENCES users (id),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_invites_email_idx ON admin_invites (lower(email));
CREATE INDEX admin_invites_invited_by_idx ON admin_invites (invited_by);
CREATE INDEX admin_invites_accepted_by_idx ON admin_invites (accepted_by);

ALTER TABLE users
    DROP COLUMN password_hash,
    DROP COLUMN failed_logins,
    DROP COLUMN locked_until;
