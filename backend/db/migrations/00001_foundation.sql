-- +goose Up
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           TEXT NOT NULL,
    provider_subject   TEXT NOT NULL,
    email              TEXT NOT NULL,
    full_name          TEXT NOT NULL DEFAULT '',
    avatar_url         TEXT NOT NULL DEFAULT '',
    phone              TEXT NOT NULL DEFAULT '',
    nationality        CHAR(2) NOT NULL DEFAULT 'ID',
    preferred_locale   TEXT NOT NULL DEFAULT 'en',
    role               TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('ADMIN', 'CUSTOMER')),
    status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'ANONYMIZED')),
    last_login_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject)
);
CREATE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_role_status_idx ON users (role, status);

CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash    BYTEA NOT NULL UNIQUE,
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    csrf_token    TEXT NOT NULL,
    user_agent    TEXT NOT NULL DEFAULT '',
    ip_address    TEXT NOT NULL DEFAULT '',
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE oauth_states (
    state          TEXT PRIMARY KEY,
    code_verifier  TEXT NOT NULL,
    nonce          TEXT NOT NULL,
    return_to      TEXT NOT NULL DEFAULT '/',
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expires_idx ON oauth_states (expires_at);

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

CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  UUID REFERENCES users (id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX settings_updated_by_idx ON settings (updated_by);

CREATE TABLE audit_logs (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id     UUID REFERENCES users (id),
    action       TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    before       JSONB,
    after        JSONB,
    request_id   TEXT NOT NULL DEFAULT '',
    ip_address   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- +goose StatementBegin
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE idempotency_keys (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope          TEXT NOT NULL,
    user_id        UUID REFERENCES users (id) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    request_hash   BYTEA NOT NULL,
    status_code    INT,
    response_body  BYTEA,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX idempotency_keys_scope_user_key_idx ON idempotency_keys (scope, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
CREATE INDEX idempotency_keys_user_idx ON idempotency_keys (user_id);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket          TEXT NOT NULL CHECK (bucket IN ('PUBLIC', 'PRIVATE')),
    base_name       TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'READY', 'FAILED', 'DELETED')),
    content_type    TEXT NOT NULL,
    width           INT,
    height          INT,
    variants        JSONB NOT NULL DEFAULT '[]'::jsonb,
    byte_size       BIGINT NOT NULL DEFAULT 0,
    failure_reason  TEXT NOT NULL DEFAULT '',
    uploaded_by     UUID REFERENCES users (id),
    delete_after    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_uploaded_by_idx ON media (uploaded_by);
CREATE INDEX media_status_created_idx ON media (status, created_at);

CREATE TABLE media_translations (
    media_id  UUID NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    locale    TEXT NOT NULL,
    alt_text  TEXT NOT NULL,
    PRIMARY KEY (media_id, locale)
);

CREATE TABLE media_usages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id     UUID NOT NULL REFERENCES media (id),
    entity_type  TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    role         TEXT NOT NULL,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, role, media_id)
);
CREATE INDEX media_usages_media_idx ON media_usages (media_id);
CREATE INDEX media_usages_entity_idx ON media_usages (entity_type, entity_id, role, sort_order);

CREATE TABLE slug_redirects (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type  TEXT NOT NULL,
    locale       TEXT NOT NULL,
    old_slug     TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, locale, old_slug)
);
CREATE INDEX slug_redirects_entity_idx ON slug_redirects (entity_type, entity_id);

-- +goose Down
DROP TABLE slug_redirects;
DROP TABLE media_usages;
DROP TABLE media_translations;
DROP TABLE media;
DROP TABLE idempotency_keys;
DROP TABLE audit_logs;
DROP FUNCTION audit_logs_immutable;
DROP TABLE settings;
DROP TABLE admin_invites;
DROP TABLE oauth_states;
DROP TABLE sessions;
DROP TABLE users;
