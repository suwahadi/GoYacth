-- +goose Up
-- Percentages are stored as basis points (10000 = 100%) so money math never needs floats.

CREATE TABLE payment_policies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    type              TEXT NOT NULL CHECK (type IN ('FULL', 'DEPOSIT')),
    deposit_type      TEXT CHECK (deposit_type IN ('PERCENTAGE', 'FIXED')),
    deposit_value     BIGINT NOT NULL DEFAULT 0 CHECK (deposit_value >= 0),
    balance_due_days  INT NOT NULL DEFAULT 0 CHECK (balance_due_days >= 0),
    status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (type = 'FULL' OR (deposit_type IS NOT NULL AND deposit_value > 0)),
    CHECK (deposit_type IS DISTINCT FROM 'PERCENTAGE' OR deposit_value < 10000)
);

CREATE TABLE cancellation_policies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cancellation_policy_tiers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id             UUID NOT NULL REFERENCES cancellation_policies (id) ON DELETE CASCADE,
    min_days_before       INT NOT NULL CHECK (min_days_before >= 0),
    refund_basis_points   INT NOT NULL CHECK (refund_basis_points BETWEEN 0 AND 10000),
    UNIQUE (policy_id, min_days_before)
);

CREATE TABLE cancellation_policy_translations (
    policy_id    UUID NOT NULL REFERENCES cancellation_policies (id) ON DELETE CASCADE,
    locale       TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (policy_id, locale)
);

CREATE TABLE partners (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    contact_name         TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    phone                TEXT NOT NULL DEFAULT '',
    bank_name            TEXT NOT NULL DEFAULT '',
    bank_account_name    TEXT NOT NULL DEFAULT '',
    bank_account_number  TEXT NOT NULL DEFAULT '',
    notes                TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE boat_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order  INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE boat_category_translations (
    category_id  UUID NOT NULL REFERENCES boat_categories (id) ON DELETE CASCADE,
    locale       TEXT NOT NULL,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL,
    PRIMARY KEY (category_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE boat_classes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order  INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE boat_class_translations (
    class_id  UUID NOT NULL REFERENCES boat_classes (id) ON DELETE CASCADE,
    locale    TEXT NOT NULL,
    name      TEXT NOT NULL,
    slug      TEXT NOT NULL,
    PRIMARY KEY (class_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE facilities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon        TEXT NOT NULL DEFAULT '',
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE facility_translations (
    facility_id  UUID NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    locale       TEXT NOT NULL,
    name         TEXT NOT NULL,
    PRIMARY KEY (facility_id, locale)
);

CREATE TABLE regions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order  INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE region_translations (
    region_id        UUID NOT NULL REFERENCES regions (id) ON DELETE CASCADE,
    locale           TEXT NOT NULL,
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (region_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE ports (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id  UUID NOT NULL REFERENCES regions (id),
    address    TEXT NOT NULL DEFAULT '',
    latitude   DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude  DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    timezone   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ports_region_idx ON ports (region_id);
CREATE TABLE port_translations (
    port_id  UUID NOT NULL REFERENCES ports (id) ON DELETE CASCADE,
    locale   TEXT NOT NULL,
    name     TEXT NOT NULL,
    PRIMARY KEY (port_id, locale)
);

CREATE TABLE routes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id          UUID NOT NULL REFERENCES regions (id),
    departure_port_id  UUID NOT NULL REFERENCES ports (id),
    return_port_id     UUID NOT NULL REFERENCES ports (id),
    duration_minutes   INT NOT NULL CHECK (duration_minutes > 0),
    status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX routes_region_idx ON routes (region_id);
CREATE INDEX routes_departure_port_idx ON routes (departure_port_id);
CREATE INDEX routes_return_port_idx ON routes (return_port_id);
CREATE TABLE route_translations (
    route_id         UUID NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
    locale           TEXT NOT NULL,
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (route_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE route_stops (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id    UUID NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
    sort_order  INT NOT NULL,
    latitude    DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    UNIQUE (route_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE route_stop_translations (
    stop_id   UUID NOT NULL REFERENCES route_stops (id) ON DELETE CASCADE,
    locale    TEXT NOT NULL,
    name      TEXT NOT NULL,
    activity  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (stop_id, locale)
);

CREATE TABLE boats (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                       TEXT NOT NULL UNIQUE,
    category_id                UUID NOT NULL REFERENCES boat_categories (id),
    class_id                   UUID NOT NULL REFERENCES boat_classes (id),
    ownership                  TEXT NOT NULL CHECK (ownership IN ('OWNED', 'PARTNER')),
    partner_id                 UUID REFERENCES partners (id),
    commission_type            TEXT CHECK (commission_type IN ('PERCENTAGE', 'FIXED')),
    commission_value           BIGINT NOT NULL DEFAULT 0 CHECK (commission_value >= 0),
    home_port_id               UUID NOT NULL REFERENCES ports (id),
    max_passengers             INT NOT NULL CHECK (max_passengers > 0),
    length_cm                  INT CHECK (length_cm > 0),
    beam_cm                    INT CHECK (beam_cm > 0),
    year_built                 INT CHECK (year_built BETWEEN 1900 AND 2100),
    cabins                     INT NOT NULL DEFAULT 0 CHECK (cabins >= 0),
    bathrooms                  INT NOT NULL DEFAULT 0 CHECK (bathrooms >= 0),
    speed_knots                INT CHECK (speed_knots > 0),
    crew_count                 INT NOT NULL DEFAULT 0 CHECK (crew_count >= 0),
    turnaround_buffer_minutes  INT NOT NULL DEFAULT 0 CHECK (turnaround_buffer_minutes >= 0),
    operating_start_minute     INT NOT NULL DEFAULT 420 CHECK (operating_start_minute BETWEEN 0 AND 1439),
    operating_end_minute       INT NOT NULL DEFAULT 1140 CHECK (operating_end_minute BETWEEN 1 AND 1440),
    overnight_allowed          BOOLEAN NOT NULL DEFAULT false,
    payment_policy_id          UUID NOT NULL REFERENCES payment_policies (id),
    cancellation_policy_id     UUID NOT NULL REFERENCES cancellation_policies (id),
    sort_order                 INT NOT NULL DEFAULT 0,
    status                     TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((ownership = 'OWNED' AND partner_id IS NULL AND commission_type IS NULL)
        OR (ownership = 'PARTNER' AND partner_id IS NOT NULL AND commission_type IS NOT NULL)),
    CHECK (commission_type IS DISTINCT FROM 'PERCENTAGE' OR commission_value <= 10000),
    CHECK (operating_end_minute > operating_start_minute)
);
CREATE INDEX boats_category_idx ON boats (category_id);
CREATE INDEX boats_class_idx ON boats (class_id);
CREATE INDEX boats_partner_idx ON boats (partner_id);
CREATE INDEX boats_home_port_idx ON boats (home_port_id);
CREATE INDEX boats_payment_policy_idx ON boats (payment_policy_id);
CREATE INDEX boats_cancellation_policy_idx ON boats (cancellation_policy_id);
CREATE INDEX boats_status_idx ON boats (status, sort_order);

CREATE TABLE boat_translations (
    boat_id          UUID NOT NULL REFERENCES boats (id) ON DELETE CASCADE,
    locale           TEXT NOT NULL,
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (boat_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE boat_rates (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_id      UUID NOT NULL REFERENCES boats (id) ON DELETE CASCADE,
    rate_unit    TEXT NOT NULL CHECK (rate_unit IN ('HOURLY', 'DAILY', 'FIXED')),
    price        BIGINT NOT NULL CHECK (price >= 0),
    min_units    INT NOT NULL DEFAULT 1 CHECK (min_units >= 1),
    max_units    INT NOT NULL DEFAULT 1 CHECK (max_units >= 1),
    UNIQUE (boat_id, rate_unit),
    CHECK (max_units >= min_units)
);

CREATE TABLE boat_regions (
    boat_id    UUID NOT NULL REFERENCES boats (id) ON DELETE CASCADE,
    region_id  UUID NOT NULL REFERENCES regions (id),
    PRIMARY KEY (boat_id, region_id)
);
CREATE INDEX boat_regions_region_idx ON boat_regions (region_id);

CREATE TABLE boat_routes (
    boat_id               UUID NOT NULL REFERENCES boats (id) ON DELETE CASCADE,
    route_id              UUID NOT NULL REFERENCES routes (id),
    fixed_price           BIGINT CHECK (fixed_price >= 0),
    min_duration_minutes  INT CHECK (min_duration_minutes > 0),
    PRIMARY KEY (boat_id, route_id)
);
CREATE INDEX boat_routes_route_idx ON boat_routes (route_id);

CREATE TABLE boat_facilities (
    boat_id      UUID NOT NULL REFERENCES boats (id) ON DELETE CASCADE,
    facility_id  UUID NOT NULL REFERENCES facilities (id),
    PRIMARY KEY (boat_id, facility_id)
);
CREATE INDEX boat_facilities_facility_idx ON boat_facilities (facility_id);

CREATE TABLE areas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_id     UUID NOT NULL REFERENCES boats (id),
    deck_label  TEXT NOT NULL DEFAULT '',
    is_system   BOOLEAN NOT NULL DEFAULT false,
    min_pax     INT NOT NULL DEFAULT 1 CHECK (min_pax >= 1),
    max_pax     INT NOT NULL CHECK (max_pax >= 1),
    base_price  BIGINT NOT NULL DEFAULT 0 CHECK (base_price >= 0),
    sort_order  INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (max_pax >= min_pax)
);
CREATE INDEX areas_boat_idx ON areas (boat_id, sort_order);
CREATE TABLE area_translations (
    area_id      UUID NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
    locale       TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (area_id, locale)
);
CREATE TABLE area_facilities (
    area_id      UUID NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
    facility_id  UUID NOT NULL REFERENCES facilities (id),
    PRIMARY KEY (area_id, facility_id)
);
CREATE INDEX area_facilities_facility_idx ON area_facilities (facility_id);

CREATE TABLE pages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE page_translations (
    page_id          UUID NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    locale           TEXT NOT NULL,
    title            TEXT NOT NULL,
    slug             TEXT NOT NULL,
    blocks           JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (page_id, locale),
    UNIQUE (locale, slug)
);

CREATE TABLE page_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL CHECK (type IN ('HERO', 'FEATURED_BOATS', 'REGIONS', 'FEATURED_PACKAGES', 'HIGHLIGHTS', 'REVIEWS', 'FAQ', 'CTA', 'PROMO_BANNER')),
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE page_section_translations (
    section_id  UUID NOT NULL REFERENCES page_sections (id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,
    content     JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (section_id, locale)
);

-- +goose Down
DROP TABLE page_section_translations;
DROP TABLE page_sections;
DROP TABLE page_translations;
DROP TABLE pages;
DROP TABLE area_facilities;
DROP TABLE area_translations;
DROP TABLE areas;
DROP TABLE boat_facilities;
DROP TABLE boat_routes;
DROP TABLE boat_regions;
DROP TABLE boat_rates;
DROP TABLE boat_translations;
DROP TABLE boats;
DROP TABLE route_stop_translations;
DROP TABLE route_stops;
DROP TABLE route_translations;
DROP TABLE routes;
DROP TABLE port_translations;
DROP TABLE ports;
DROP TABLE region_translations;
DROP TABLE regions;
DROP TABLE facility_translations;
DROP TABLE facilities;
DROP TABLE boat_class_translations;
DROP TABLE boat_classes;
DROP TABLE boat_category_translations;
DROP TABLE boat_categories;
DROP TABLE partners;
DROP TABLE cancellation_policy_translations;
DROP TABLE cancellation_policy_tiers;
DROP TABLE cancellation_policies;
DROP TABLE payment_policies;
