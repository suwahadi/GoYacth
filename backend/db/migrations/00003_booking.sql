-- +goose Up

CREATE TABLE seasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('LOW', 'HIGH', 'PEAK')),
    starts_on   DATE NOT NULL,
    ends_on     DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);
CREATE INDEX seasons_range_idx ON seasons (starts_on, ends_on);

CREATE TABLE packages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode                    TEXT NOT NULL CHECK (mode IN ('PRIVATE_CHARTER', 'DEPARTURE')),
    route_id                UUID REFERENCES routes (id),
    duration_minutes        INT CHECK (duration_minutes > 0),
    departure_id            UUID,
    min_pax                 INT NOT NULL DEFAULT 1 CHECK (min_pax >= 1),
    max_pax                 INT NOT NULL CHECK (max_pax >= 1),
    valid_from              DATE NOT NULL,
    valid_until             DATE NOT NULL,
    booking_cutoff_hours    INT NOT NULL DEFAULT 24 CHECK (booking_cutoff_hours >= 0),
    payment_policy_id       UUID NOT NULL REFERENCES payment_policies (id),
    cancellation_policy_id  UUID NOT NULL REFERENCES cancellation_policies (id),
    sort_order              INT NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (max_pax >= min_pax),
    CHECK (valid_until >= valid_from),
    CHECK ((mode = 'PRIVATE_CHARTER' AND route_id IS NOT NULL AND duration_minutes IS NOT NULL AND departure_id IS NULL)
        OR (mode = 'DEPARTURE' AND departure_id IS NOT NULL))
);
CREATE INDEX packages_route_idx ON packages (route_id);
CREATE INDEX packages_departure_idx ON packages (departure_id);
CREATE INDEX packages_payment_policy_idx ON packages (payment_policy_id);
CREATE INDEX packages_cancellation_policy_idx ON packages (cancellation_policy_id);
CREATE INDEX packages_status_idx ON packages (status, sort_order);

CREATE TABLE package_translations (
    package_id       UUID NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
    locale           TEXT NOT NULL,
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    inclusions       JSONB NOT NULL DEFAULT '[]'::jsonb,
    exclusions       JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (package_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE departures (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_id            UUID NOT NULL REFERENCES boats (id),
    route_id           UUID NOT NULL REFERENCES routes (id),
    departs_at         TIMESTAMPTZ NOT NULL,
    returns_at         TIMESTAMPTZ NOT NULL,
    booking_closes_at  TIMESTAMPTZ NOT NULL,
    status             TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'CANCELLED')),
    cancel_reason      TEXT NOT NULL DEFAULT '',
    created_by         UUID REFERENCES users (id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (returns_at > departs_at),
    CHECK (booking_closes_at <= departs_at)
);
CREATE INDEX departures_boat_idx ON departures (boat_id, departs_at);
CREATE INDEX departures_route_idx ON departures (route_id);
CREATE INDEX departures_departs_idx ON departures (status, departs_at);
CREATE INDEX departures_created_by_idx ON departures (created_by);

ALTER TABLE packages ADD CONSTRAINT packages_departure_fk FOREIGN KEY (departure_id) REFERENCES departures (id);

CREATE TABLE departure_slots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    departure_id  UUID NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
    slot_type     TEXT NOT NULL CHECK (slot_type IN ('PRIVATE_AREA', 'SEAT_POOL')),
    price         BIGINT NOT NULL CHECK (price >= 0),
    seat_capacity INT CHECK (seat_capacity > 0),
    min_pax       INT NOT NULL DEFAULT 1 CHECK (min_pax >= 1),
    max_pax       INT NOT NULL CHECK (max_pax >= 1),
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((slot_type = 'SEAT_POOL' AND seat_capacity IS NOT NULL) OR (slot_type = 'PRIVATE_AREA' AND seat_capacity IS NULL)),
    CHECK (max_pax >= min_pax)
);
CREATE INDEX departure_slots_departure_idx ON departure_slots (departure_id, sort_order);

CREATE TABLE departure_slot_areas (
    departure_id  UUID NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
    slot_id       UUID NOT NULL REFERENCES departure_slots (id) ON DELETE CASCADE,
    area_id       UUID NOT NULL REFERENCES areas (id),
    PRIMARY KEY (slot_id, area_id),
    UNIQUE (departure_id, area_id)
);
CREATE INDEX departure_slot_areas_area_idx ON departure_slot_areas (area_id);

CREATE TABLE package_offerings (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id         UUID NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
    boat_id            UUID NOT NULL REFERENCES boats (id),
    departure_slot_id  UUID REFERENCES departure_slots (id),
    price              BIGINT NOT NULL CHECK (price >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX package_offerings_unique_idx ON package_offerings (package_id, boat_id, COALESCE(departure_slot_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX package_offerings_boat_idx ON package_offerings (boat_id);
CREATE INDEX package_offerings_slot_idx ON package_offerings (departure_slot_id);

CREATE TABLE price_overrides (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_rate_id         UUID REFERENCES boat_rates (id) ON DELETE CASCADE,
    package_offering_id  UUID REFERENCES package_offerings (id) ON DELETE CASCADE,
    rule_type            TEXT NOT NULL CHECK (rule_type IN ('DATE', 'SEASON', 'WEEKEND', 'WEEKDAY')),
    on_date              DATE,
    season_id            UUID REFERENCES seasons (id),
    price                BIGINT NOT NULL CHECK (price >= 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(boat_rate_id, package_offering_id) = 1),
    CHECK ((rule_type = 'DATE') = (on_date IS NOT NULL)),
    CHECK ((rule_type = 'SEASON') = (season_id IS NOT NULL))
);
CREATE INDEX price_overrides_boat_rate_idx ON price_overrides (boat_rate_id);
CREATE INDEX price_overrides_offering_idx ON price_overrides (package_offering_id);
CREATE INDEX price_overrides_season_idx ON price_overrides (season_id);

CREATE TABLE promotions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    code            TEXT,
    is_automatic    BOOLEAN NOT NULL DEFAULT false,
    discount_type   TEXT NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED', 'PRICE')),
    discount_value  BIGINT NOT NULL CHECK (discount_value >= 0),
    boat_id         UUID REFERENCES boats (id),
    package_id      UUID REFERENCES packages (id),
    booking_mode    TEXT CHECK (booking_mode IN ('PRIVATE_CHARTER', 'DEPARTURE')),
    min_subtotal    BIGINT NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    quota           INT CHECK (quota > 0),
    used_count      INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (quota IS NULL OR used_count <= quota),
    CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 10000),
    CHECK (is_automatic OR code IS NOT NULL)
);
CREATE UNIQUE INDEX promotions_code_idx ON promotions (upper(code)) WHERE code IS NOT NULL;
CREATE INDEX promotions_boat_idx ON promotions (boat_id);
CREATE INDEX promotions_package_idx ON promotions (package_id);
CREATE INDEX promotions_active_idx ON promotions (status, starts_at, ends_at);

CREATE TABLE tax_lines (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     TEXT NOT NULL UNIQUE,
    basis_points             INT NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
    includes_previous_lines  BOOLEAN NOT NULL DEFAULT false,
    sort_order               INT NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tax_line_translations (
    tax_line_id  UUID NOT NULL REFERENCES tax_lines (id) ON DELETE CASCADE,
    locale       TEXT NOT NULL,
    name         TEXT NOT NULL,
    PRIMARY KEY (tax_line_id, locale)
);

CREATE TABLE payment_method_fees (
    method        TEXT PRIMARY KEY CHECK (method IN ('CREDIT_CARD', 'QRIS', 'BCA_VA', 'BNI_VA', 'BRI_VA', 'MANDIRI_VA', 'PERMATA_VA')),
    fee_type      TEXT NOT NULL DEFAULT 'FIXED' CHECK (fee_type IN ('FIXED', 'PERCENTAGE')),
    fee_value     BIGINT NOT NULL DEFAULT 0 CHECK (fee_value >= 0),
    hold_minutes  INT NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 5 AND 1440),
    enabled       BOOLEAN NOT NULL DEFAULT true,
    sort_order    INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (fee_type <> 'PERCENTAGE' OR fee_value <= 10000)
);

CREATE TABLE boat_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_id     UUID NOT NULL REFERENCES boats (id),
    area_id     UUID REFERENCES areas (id),
    kind        TEXT NOT NULL CHECK (kind IN ('MAINTENANCE', 'MANUAL')),
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    created_by  UUID REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX boat_blocks_boat_idx ON boat_blocks (boat_id, starts_at);
CREATE INDEX boat_blocks_area_idx ON boat_blocks (area_id);
CREATE INDEX boat_blocks_created_by_idx ON boat_blocks (created_by);

CREATE TABLE bookings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    booking_number         TEXT NOT NULL UNIQUE CHECK (booking_number ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
    invoice_number         TEXT UNIQUE,
    user_id                UUID NOT NULL REFERENCES users (id),
    mode                   TEXT NOT NULL CHECK (mode IN ('PRIVATE_CHARTER', 'DEPARTURE')),
    package_id             UUID REFERENCES packages (id),
    boat_id                UUID NOT NULL REFERENCES boats (id),
    route_id               UUID NOT NULL REFERENCES routes (id),
    departure_id           UUID REFERENCES departures (id),
    departure_slot_id      UUID REFERENCES departure_slots (id),
    is_private_slot        BOOLEAN NOT NULL DEFAULT false,
    starts_at              TIMESTAMPTZ NOT NULL,
    ends_at                TIMESTAMPTZ NOT NULL,
    timezone               TEXT NOT NULL,
    pax                    INT NOT NULL CHECK (pax >= 1),
    status                 TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
    payment_status         TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'DEPOSIT_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    payment_scheme         TEXT NOT NULL CHECK (payment_scheme IN ('FULL', 'DEPOSIT')),
    subtotal               BIGINT NOT NULL CHECK (subtotal >= 0),
    grand_total            BIGINT NOT NULL CHECK (grand_total >= 0),
    deposit_amount         BIGINT NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
    amount_paid            BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    fees_paid              BIGINT NOT NULL DEFAULT 0 CHECK (fees_paid >= 0),
    amount_refunded        BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
    forfeited_amount       BIGINT NOT NULL DEFAULT 0 CHECK (forfeited_amount >= 0),
    currency               TEXT NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    hold_expires_at        TIMESTAMPTZ,
    balance_due_at         TIMESTAMPTZ,
    snapshot               JSONB NOT NULL,
    consents               JSONB NOT NULL,
    lead_full_name         TEXT NOT NULL,
    lead_email             TEXT NOT NULL,
    lead_phone             TEXT NOT NULL,
    lead_nationality       CHAR(2) NOT NULL,
    special_request        TEXT NOT NULL DEFAULT '',
    locale                 TEXT NOT NULL DEFAULT 'en',
    verify_token           TEXT NOT NULL UNIQUE,
    verify_token_revoked   BOOLEAN NOT NULL DEFAULT false,
    exception_reason       TEXT,
    cancel_type            TEXT CHECK (cancel_type IN ('CUSTOMER', 'OPERATOR', 'DEPARTURE_CANCELLED', 'BALANCE_OVERDUE', 'CUSTOMER_UNPAID')),
    cancel_reason          TEXT NOT NULL DEFAULT '',
    cancelled_at           TIMESTAMPTZ,
    created_by_admin       UUID REFERENCES users (id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK ((mode = 'DEPARTURE') = (departure_slot_id IS NOT NULL)),
    CHECK (amount_paid <= grand_total),
    CHECK (status <> 'PENDING_PAYMENT' OR hold_expires_at IS NOT NULL)
);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_package_idx ON bookings (package_id);
CREATE INDEX bookings_boat_idx ON bookings (boat_id, starts_at);
CREATE INDEX bookings_route_idx ON bookings (route_id);
CREATE INDEX bookings_departure_idx ON bookings (departure_id);
CREATE INDEX bookings_slot_idx ON bookings (departure_slot_id, status);
CREATE INDEX bookings_status_starts_idx ON bookings (status, starts_at);
CREATE INDEX bookings_hold_idx ON bookings (hold_expires_at) WHERE status = 'PENDING_PAYMENT';
CREATE INDEX bookings_balance_due_idx ON bookings (balance_due_at) WHERE payment_status = 'DEPOSIT_PAID';
CREATE INDEX bookings_exception_idx ON bookings (created_at) WHERE exception_reason IS NOT NULL;
CREATE INDEX bookings_created_by_admin_idx ON bookings (created_by_admin);
CREATE INDEX bookings_lead_email_idx ON bookings (lower(lead_email));
-- A private-area slot can be owned by at most one live booking. Expired holds are moved to EXPIRED
-- inside the booking transaction before this index is checked.
CREATE UNIQUE INDEX bookings_private_slot_unique_idx ON bookings (departure_slot_id)
    WHERE is_private_slot AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');

CREATE TABLE area_reservations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id       UUID NOT NULL REFERENCES areas (id),
    boat_id       UUID NOT NULL REFERENCES boats (id),
    period        TSTZRANGE NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('CHARTER', 'DEPARTURE', 'BLOCK')),
    booking_id    UUID REFERENCES bookings (id) ON DELETE CASCADE,
    departure_id  UUID REFERENCES departures (id) ON DELETE CASCADE,
    block_id      UUID REFERENCES boat_blocks (id) ON DELETE CASCADE,
    status        TEXT NOT NULL CHECK (status IN ('HELD', 'ACTIVE')),
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(booking_id, departure_id, block_id) = 1),
    CHECK ((kind = 'CHARTER') = (booking_id IS NOT NULL)),
    CHECK ((kind = 'DEPARTURE') = (departure_id IS NOT NULL)),
    CHECK ((kind = 'BLOCK') = (block_id IS NOT NULL)),
    CHECK ((status = 'HELD') = (expires_at IS NOT NULL)),
    CHECK (NOT isempty(period)),
    EXCLUDE USING gist (area_id WITH =, period WITH &&)
);
CREATE INDEX area_reservations_boat_period_idx ON area_reservations USING gist (boat_id, period);
CREATE INDEX area_reservations_booking_idx ON area_reservations (booking_id);
CREATE INDEX area_reservations_departure_idx ON area_reservations (departure_id);
CREATE INDEX area_reservations_block_idx ON area_reservations (block_id);
CREATE INDEX area_reservations_expires_idx ON area_reservations (expires_at) WHERE status = 'HELD';

CREATE TABLE booking_guests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    sort_order  INT NOT NULL,
    full_name   TEXT NOT NULL,
    phone       TEXT NOT NULL DEFAULT '',
    UNIQUE (booking_id, sort_order)
);

CREATE TABLE booking_identities (
    booking_id  UUID PRIMARY KEY REFERENCES bookings (id) ON DELETE CASCADE,
    id_type     TEXT NOT NULL CHECK (id_type IN ('KTP', 'SIM', 'PASSPORT', 'KITAS')),
    ciphertext  BYTEA,
    key_id      TEXT,
    last4       TEXT NOT NULL DEFAULT '',
    purged_at   TIMESTAMPTZ,
    CHECK ((purged_at IS NULL) = (ciphertext IS NOT NULL))
);

CREATE TABLE promotion_redemptions (
    promotion_id  UUID NOT NULL REFERENCES promotions (id),
    booking_id    UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    status        TEXT NOT NULL CHECK (status IN ('HELD', 'USED', 'RELEASED')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (promotion_id, booking_id)
);
CREATE INDEX promotion_redemptions_booking_idx ON promotion_redemptions (booking_id);

CREATE TABLE invoice_sequences (
    year        INT PRIMARY KEY,
    last_value  BIGINT NOT NULL
);

CREATE TABLE faqs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category    TEXT NOT NULL DEFAULT 'GENERAL',
    boat_id     UUID REFERENCES boats (id) ON DELETE CASCADE,
    package_id  UUID REFERENCES packages (id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX faqs_boat_idx ON faqs (boat_id);
CREATE INDEX faqs_package_idx ON faqs (package_id);
CREATE INDEX faqs_category_idx ON faqs (status, category, sort_order);
CREATE TABLE faq_translations (
    faq_id    UUID NOT NULL REFERENCES faqs (id) ON DELETE CASCADE,
    locale    TEXT NOT NULL,
    question  TEXT NOT NULL,
    answer    TEXT NOT NULL,
    PRIMARY KEY (faq_id, locale)
);

-- +goose Down
DROP TABLE faq_translations;
DROP TABLE faqs;
DROP TABLE invoice_sequences;
DROP TABLE promotion_redemptions;
DROP TABLE booking_identities;
DROP TABLE booking_guests;
DROP TABLE area_reservations;
DROP TABLE bookings;
DROP TABLE boat_blocks;
DROP TABLE payment_method_fees;
DROP TABLE tax_line_translations;
DROP TABLE tax_lines;
DROP TABLE promotions;
DROP TABLE price_overrides;
DROP TABLE package_offerings;
DROP TABLE departure_slot_areas;
DROP TABLE departure_slots;
ALTER TABLE packages DROP CONSTRAINT packages_departure_fk;
DROP TABLE departures;
DROP TABLE package_translations;
DROP TABLE packages;
DROP TABLE seasons;
