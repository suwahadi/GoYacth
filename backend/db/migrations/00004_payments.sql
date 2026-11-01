-- +goose Up

CREATE TABLE payments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id           UUID NOT NULL REFERENCES bookings (id),
    kind                 TEXT NOT NULL CHECK (kind IN ('FULL', 'DEPOSIT', 'BALANCE')),
    provider             TEXT NOT NULL CHECK (provider IN ('MIDTRANS', 'MANUAL')),
    method               TEXT NOT NULL CHECK (method IN ('CREDIT_CARD', 'QRIS', 'BCA_VA', 'BNI_VA', 'BRI_VA', 'MANDIRI_VA', 'PERMATA_VA', 'BANK_TRANSFER', 'CASH')),
    order_id             TEXT NOT NULL UNIQUE,
    principal_amount     BIGINT NOT NULL CHECK (principal_amount > 0),
    fee_amount           BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    gross_amount         BIGINT NOT NULL CHECK (gross_amount = principal_amount + fee_amount),
    currency             TEXT NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
    provider_status      TEXT NOT NULL DEFAULT '',
    provider_fraud       TEXT NOT NULL DEFAULT '',
    provider_txn_id      TEXT NOT NULL DEFAULT '',
    provider_payment_type TEXT NOT NULL DEFAULT '',
    snap_token           TEXT NOT NULL DEFAULT '',
    snap_redirect_url    TEXT NOT NULL DEFAULT '',
    va_numbers           JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at           TIMESTAMPTZ,
    paid_at              TIMESTAMPTZ,
    is_exception         BOOLEAN NOT NULL DEFAULT false,
    manual_paid_on       DATE,
    proof_media_id       UUID REFERENCES media (id),
    recorded_by          UUID REFERENCES users (id),
    notes                TEXT NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id, created_at);
CREATE INDEX payments_status_idx ON payments (status, created_at);
CREATE INDEX payments_pending_provider_idx ON payments (created_at) WHERE status = 'PENDING' AND provider = 'MIDTRANS';
CREATE INDEX payments_proof_media_idx ON payments (proof_media_id);
CREATE INDEX payments_recorded_by_idx ON payments (recorded_by);
-- Only one open Midtrans attempt per booking at a time keeps Snap tokens from racing each other.
CREATE UNIQUE INDEX payments_one_pending_idx ON payments (booking_id) WHERE status = 'PENDING';

CREATE TABLE payment_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          UUID REFERENCES payments (id),
    order_id            TEXT NOT NULL,
    dedupe_key          TEXT NOT NULL UNIQUE,
    source              TEXT NOT NULL CHECK (source IN ('WEBHOOK', 'RECONCILE')),
    transaction_status  TEXT NOT NULL DEFAULT '',
    fraud_status        TEXT NOT NULL DEFAULT '',
    status_code         TEXT NOT NULL DEFAULT '',
    gross_amount        TEXT NOT NULL DEFAULT '',
    verdict             TEXT NOT NULL CHECK (verdict IN ('APPLIED', 'IGNORED', 'REJECTED')),
    verdict_reason      TEXT NOT NULL DEFAULT '',
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, created_at);
CREATE INDEX payment_events_order_idx ON payment_events (order_id);
CREATE INDEX payment_events_created_idx ON payment_events (created_at DESC);

CREATE TABLE booking_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   UUID NOT NULL REFERENCES bookings (id),
    type         TEXT NOT NULL CHECK (type IN ('CANCEL', 'RESCHEDULE')),
    status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    message      TEXT NOT NULL DEFAULT '',
    resolution   TEXT NOT NULL DEFAULT '',
    resolved_by  UUID REFERENCES users (id),
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_requests_booking_idx ON booking_requests (booking_id);
CREATE INDEX booking_requests_status_idx ON booking_requests (status, created_at);
CREATE INDEX booking_requests_resolved_by_idx ON booking_requests (resolved_by);
CREATE UNIQUE INDEX booking_requests_one_pending_idx ON booking_requests (booking_id, type) WHERE status = 'PENDING';

CREATE TABLE refunds (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id            UUID NOT NULL REFERENCES bookings (id),
    payment_id            UUID REFERENCES payments (id),
    reason_type           TEXT NOT NULL CHECK (reason_type IN ('CUSTOMER', 'OPERATOR', 'DEPARTURE_CANCELLED', 'EXCEPTION', 'RESCHEDULE')),
    amount                BIGINT NOT NULL CHECK (amount > 0),
    includes_fee_amount   BIGINT NOT NULL DEFAULT 0 CHECK (includes_fee_amount >= 0),
    channel               TEXT NOT NULL CHECK (channel IN ('PROVIDER', 'MANUAL')),
    status                TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED')),
    provider_refund_key   TEXT UNIQUE,
    bank_name             TEXT NOT NULL DEFAULT '',
    bank_account_name     TEXT NOT NULL DEFAULT '',
    bank_account_number   TEXT NOT NULL DEFAULT '',
    proof_media_id        UUID REFERENCES media (id),
    notes                 TEXT NOT NULL DEFAULT '',
    requested_by          UUID REFERENCES users (id),
    approved_by           UUID REFERENCES users (id),
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (includes_fee_amount <= amount),
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE INDEX refunds_status_idx ON refunds (status, created_at);
CREATE INDEX refunds_proof_media_idx ON refunds (proof_media_id);
CREATE INDEX refunds_requested_by_idx ON refunds (requested_by);
CREATE INDEX refunds_approved_by_idx ON refunds (approved_by);

CREATE TABLE payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id      UUID NOT NULL REFERENCES partners (id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    amount          BIGINT NOT NULL CHECK (amount >= 0),
    paid_on         DATE NOT NULL,
    proof_media_id  UUID REFERENCES media (id),
    notes           TEXT NOT NULL DEFAULT '',
    recorded_by     UUID REFERENCES users (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);
CREATE INDEX payouts_partner_idx ON payouts (partner_id, period_start);
CREATE INDEX payouts_proof_media_idx ON payouts (proof_media_id);
CREATE INDEX payouts_recorded_by_idx ON payouts (recorded_by);

CREATE TABLE payout_bookings (
    payout_id       UUID NOT NULL REFERENCES payouts (id),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings (id),
    partner_amount  BIGINT NOT NULL,
    PRIMARY KEY (payout_id, booking_id)
);

CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings (id),
    user_id         UUID NOT NULL REFERENCES users (id),
    boat_id         UUID NOT NULL REFERENCES boats (id),
    rating_overall  INT NOT NULL CHECK (rating_overall BETWEEN 1 AND 5),
    rating_boat     INT NOT NULL CHECK (rating_boat BETWEEN 1 AND 5),
    rating_service  INT NOT NULL CHECK (rating_service BETWEEN 1 AND 5),
    rating_crew     INT NOT NULL CHECK (rating_crew BETWEEN 1 AND 5),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    locale          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'REJECTED')),
    is_featured     BOOLEAN NOT NULL DEFAULT false,
    moderated_by    UUID REFERENCES users (id),
    moderated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT is_featured OR status = 'PUBLISHED')
);
CREATE INDEX reviews_user_idx ON reviews (user_id);
CREATE INDEX reviews_boat_idx ON reviews (boat_id, status, created_at DESC);
CREATE INDEX reviews_status_idx ON reviews (status, created_at DESC);
CREATE INDEX reviews_featured_idx ON reviews (created_at DESC) WHERE is_featured;
CREATE INDEX reviews_moderated_by_idx ON reviews (moderated_by);

CREATE TABLE notification_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         TEXT NOT NULL,
    dedupe_key   TEXT NOT NULL UNIQUE,
    booking_id   UUID REFERENCES bookings (id),
    user_id      UUID REFERENCES users (id),
    recipient    TEXT NOT NULL,
    locale       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts     INT NOT NULL DEFAULT 0,
    last_error   TEXT NOT NULL DEFAULT '',
    sent_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_logs_booking_idx ON notification_logs (booking_id);
CREATE INDEX notification_logs_user_idx ON notification_logs (user_id);
CREATE INDEX notification_logs_status_idx ON notification_logs (status, created_at);

-- +goose Down
DROP TABLE notification_logs;
DROP TABLE reviews;
DROP TABLE payout_bookings;
DROP TABLE payouts;
DROP TABLE refunds;
DROP TABLE booking_requests;
DROP TABLE payment_events;
DROP TABLE payments;
