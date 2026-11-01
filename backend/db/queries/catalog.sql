-- Partners

-- name: ListPartners :many
SELECT * FROM partners WHERE (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status)) ORDER BY name LIMIT 500;

-- name: GetPartner :one
SELECT * FROM partners WHERE id = $1;

-- name: InsertPartner :one
INSERT INTO partners (name, contact_name, email, phone, bank_name, bank_account_name, bank_account_number, notes, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: UpdatePartner :one
UPDATE partners SET name = $2, contact_name = $3, email = $4, phone = $5, bank_name = $6, bank_account_name = $7,
    bank_account_number = $8, notes = $9, status = $10, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeletePartner :execrows
DELETE FROM partners WHERE id = $1;

-- Simple translated master data (categories, classes, facilities)

-- name: ListCategories :many
SELECT c.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name, 'slug', t.slug)) FROM boat_category_translations t WHERE t.category_id = c.id), '{}')::jsonb AS translations
FROM boat_categories c ORDER BY c.sort_order, c.created_at;

-- name: InsertCategory :one
INSERT INTO boat_categories (sort_order, status) VALUES ($1, $2) RETURNING *;

-- name: UpdateCategory :one
UPDATE boat_categories SET sort_order = $2, status = $3 WHERE id = $1 RETURNING *;

-- name: UpsertCategoryTranslation :exec
INSERT INTO boat_category_translations (category_id, locale, name, slug) VALUES ($1, $2, $3, $4)
ON CONFLICT (category_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- name: DeleteCategory :execrows
DELETE FROM boat_categories WHERE id = $1;

-- name: ListClasses :many
SELECT c.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name, 'slug', t.slug)) FROM boat_class_translations t WHERE t.class_id = c.id), '{}')::jsonb AS translations
FROM boat_classes c ORDER BY c.sort_order, c.created_at;

-- name: InsertClass :one
INSERT INTO boat_classes (sort_order, status) VALUES ($1, $2) RETURNING *;

-- name: UpdateClass :one
UPDATE boat_classes SET sort_order = $2, status = $3 WHERE id = $1 RETURNING *;

-- name: UpsertClassTranslation :exec
INSERT INTO boat_class_translations (class_id, locale, name, slug) VALUES ($1, $2, $3, $4)
ON CONFLICT (class_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- name: DeleteClass :execrows
DELETE FROM boat_classes WHERE id = $1;

-- name: ListFacilities :many
SELECT f.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name)) FROM facility_translations t WHERE t.facility_id = f.id), '{}')::jsonb AS translations
FROM facilities f ORDER BY f.sort_order, f.created_at;

-- name: InsertFacility :one
INSERT INTO facilities (icon, sort_order) VALUES ($1, $2) RETURNING *;

-- name: UpdateFacility :one
UPDATE facilities SET icon = $2, sort_order = $3 WHERE id = $1 RETURNING *;

-- name: UpsertFacilityTranslation :exec
INSERT INTO facility_translations (facility_id, locale, name) VALUES ($1, $2, $3)
ON CONFLICT (facility_id, locale) DO UPDATE SET name = EXCLUDED.name;

-- name: DeleteFacility :execrows
DELETE FROM facilities WHERE id = $1;

-- Regions

-- name: ListRegionsAdmin :many
SELECT r.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'region_id' - 'locale') FROM region_translations t WHERE t.region_id = r.id), '{}')::jsonb AS translations
FROM regions r ORDER BY r.sort_order, r.created_at;

-- name: GetRegionAdmin :one
SELECT r.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'region_id' - 'locale') FROM region_translations t WHERE t.region_id = r.id), '{}')::jsonb AS translations
FROM regions r WHERE r.id = $1;

-- name: InsertRegion :one
INSERT INTO regions (sort_order, status) VALUES ($1, $2) RETURNING *;

-- name: UpdateRegion :one
UPDATE regions SET sort_order = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: GetRegionTranslation :one
SELECT * FROM region_translations WHERE region_id = $1 AND locale = $2;

-- name: UpsertRegionTranslation :exec
INSERT INTO region_translations (region_id, locale, name, slug, description, seo_title, seo_description)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (region_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, description = EXCLUDED.description,
    seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description;

-- name: DeleteRegion :execrows
DELETE FROM regions WHERE id = $1;

-- name: ListRegionsPublic :many
SELECT r.id, r.sort_order, t.locale, t.name, t.slug, t.description, t.seo_title, t.seo_description
FROM regions r
JOIN LATERAL (
    SELECT * FROM region_translations rt WHERE rt.region_id = r.id AND rt.locale IN (sqlc.arg(locale)::text, 'en')
    ORDER BY (rt.locale = sqlc.arg(locale)::text) DESC LIMIT 1
) t ON true
WHERE r.status = 'PUBLISHED'
ORDER BY r.sort_order, t.name;

-- Ports

-- name: ListPorts :many
SELECT p.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name)) FROM port_translations t WHERE t.port_id = p.id), '{}')::jsonb AS translations
FROM ports p ORDER BY p.created_at;

-- name: GetPort :one
SELECT * FROM ports WHERE id = $1;

-- name: InsertPort :one
INSERT INTO ports (region_id, address, latitude, longitude, timezone, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdatePort :one
UPDATE ports SET region_id = $2, address = $3, latitude = $4, longitude = $5, timezone = $6, status = $7, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: UpsertPortTranslation :exec
INSERT INTO port_translations (port_id, locale, name) VALUES ($1, $2, $3)
ON CONFLICT (port_id, locale) DO UPDATE SET name = EXCLUDED.name;

-- name: DeletePort :execrows
DELETE FROM ports WHERE id = $1;

-- Routes

-- name: ListRoutesAdmin :many
SELECT r.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'route_id' - 'locale') FROM route_translations t WHERE t.route_id = r.id), '{}')::jsonb AS translations
FROM routes r ORDER BY r.created_at;

-- name: GetRouteAdmin :one
SELECT r.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'route_id' - 'locale') FROM route_translations t WHERE t.route_id = r.id), '{}')::jsonb AS translations
FROM routes r WHERE r.id = $1;

-- name: InsertRoute :one
INSERT INTO routes (region_id, departure_port_id, return_port_id, duration_minutes, status) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateRoute :one
UPDATE routes SET region_id = $2, departure_port_id = $3, return_port_id = $4, duration_minutes = $5, status = $6, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: GetRouteTranslation :one
SELECT * FROM route_translations WHERE route_id = $1 AND locale = $2;

-- name: UpsertRouteTranslation :exec
INSERT INTO route_translations (route_id, locale, name, slug, description, seo_title, seo_description)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (route_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, description = EXCLUDED.description,
    seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description;

-- name: DeleteRoute :execrows
DELETE FROM routes WHERE id = $1;

-- name: DeleteRouteStops :exec
DELETE FROM route_stops WHERE route_id = $1;

-- name: InsertRouteStop :one
INSERT INTO route_stops (route_id, sort_order, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: UpsertRouteStopTranslation :exec
INSERT INTO route_stop_translations (stop_id, locale, name, activity) VALUES ($1, $2, $3, $4)
ON CONFLICT (stop_id, locale) DO UPDATE SET name = EXCLUDED.name, activity = EXCLUDED.activity;

-- name: ListRouteStops :many
SELECT s.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name, 'activity', t.activity)) FROM route_stop_translations t WHERE t.stop_id = s.id), '{}')::jsonb AS translations
FROM route_stops s WHERE s.route_id = ANY(sqlc.arg(route_ids)::uuid[]) ORDER BY s.route_id, s.sort_order;

-- name: ListRoutesPublic :many
SELECT r.id, r.region_id, r.departure_port_id, r.return_port_id, r.duration_minutes, t.locale, t.name, t.slug, t.description, t.seo_title, t.seo_description
FROM routes r
JOIN regions rg ON rg.id = r.region_id AND rg.status = 'PUBLISHED'
JOIN LATERAL (
    SELECT * FROM route_translations rt WHERE rt.route_id = r.id AND rt.locale IN (sqlc.arg(locale)::text, 'en')
    ORDER BY (rt.locale = sqlc.arg(locale)::text) DESC LIMIT 1
) t ON true
WHERE r.status = 'PUBLISHED' AND (sqlc.narg(region_id)::uuid IS NULL OR r.region_id = sqlc.narg(region_id))
ORDER BY t.name;

-- Boats

-- name: ListBoatsAdmin :many
SELECT b.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'boat_id' - 'locale') FROM boat_translations t WHERE t.boat_id = b.id), '{}')::jsonb AS translations
FROM boats b
WHERE (sqlc.narg(status)::text IS NULL OR b.status = sqlc.narg(status))
ORDER BY b.sort_order, b.created_at
LIMIT $1 OFFSET $2;

-- name: CountBoatsAdmin :one
SELECT count(*) FROM boats b WHERE (sqlc.narg(status)::text IS NULL OR b.status = sqlc.narg(status));

-- name: GetBoatAdmin :one
SELECT b.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'boat_id' - 'locale') FROM boat_translations t WHERE t.boat_id = b.id), '{}')::jsonb AS translations
FROM boats b WHERE b.id = $1;

-- name: GetBoat :one
SELECT * FROM boats WHERE id = $1;

-- name: InsertBoat :one
INSERT INTO boats (code, category_id, class_id, ownership, partner_id, commission_type, commission_value, home_port_id, max_passengers,
    length_cm, beam_cm, year_built, cabins, bathrooms, speed_knots, crew_count, turnaround_buffer_minutes, operating_start_minute,
    operating_end_minute, overnight_allowed, payment_policy_id, cancellation_policy_id, sort_order, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
RETURNING *;

-- name: UpdateBoat :one
UPDATE boats SET code = $2, category_id = $3, class_id = $4, ownership = $5, partner_id = $6, commission_type = $7, commission_value = $8,
    home_port_id = $9, max_passengers = $10, length_cm = $11, beam_cm = $12, year_built = $13, cabins = $14, bathrooms = $15,
    speed_knots = $16, crew_count = $17, turnaround_buffer_minutes = $18, operating_start_minute = $19, operating_end_minute = $20,
    overnight_allowed = $21, payment_policy_id = $22, cancellation_policy_id = $23, sort_order = $24, status = $25, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: GetBoatTranslation :one
SELECT * FROM boat_translations WHERE boat_id = $1 AND locale = $2;

-- name: UpsertBoatTranslation :exec
INSERT INTO boat_translations (boat_id, locale, name, slug, summary, description, seo_title, seo_description)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (boat_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, summary = EXCLUDED.summary,
    description = EXCLUDED.description, seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description;

-- name: CountBoatBookings :one
SELECT (SELECT count(*) FROM bookings bk WHERE bk.boat_id = sqlc.arg(boat_id)::uuid) + (SELECT count(*) FROM departures d WHERE d.boat_id = sqlc.arg(boat_id)::uuid);

-- name: DeleteBoatAreas :exec
DELETE FROM areas WHERE boat_id = $1;

-- name: DeleteBoat :execrows
DELETE FROM boats WHERE id = $1;

-- name: ListBoatRates :many
SELECT * FROM boat_rates WHERE boat_id = ANY(sqlc.arg(boat_ids)::uuid[]) ORDER BY rate_unit;

-- name: DeleteBoatRatesExcept :exec
DELETE FROM boat_rates WHERE boat_id = $1 AND NOT (rate_unit = ANY(sqlc.arg(keep)::text[]));

-- name: UpsertBoatRate :exec
INSERT INTO boat_rates (boat_id, rate_unit, price, min_units, max_units) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (boat_id, rate_unit) DO UPDATE SET price = EXCLUDED.price, min_units = EXCLUDED.min_units, max_units = EXCLUDED.max_units;

-- name: ListBoatRegions :many
SELECT * FROM boat_regions WHERE boat_id = ANY(sqlc.arg(boat_ids)::uuid[]);

-- name: DeleteBoatRegions :exec
DELETE FROM boat_regions WHERE boat_id = $1;

-- name: InsertBoatRegion :exec
INSERT INTO boat_regions (boat_id, region_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: ListBoatRoutes :many
SELECT * FROM boat_routes WHERE boat_id = ANY(sqlc.arg(boat_ids)::uuid[]);

-- name: DeleteBoatRoutes :exec
DELETE FROM boat_routes WHERE boat_id = $1;

-- name: InsertBoatRoute :exec
INSERT INTO boat_routes (boat_id, route_id, fixed_price, min_duration_minutes) VALUES ($1, $2, $3, $4);

-- name: GetBoatRoute :one
SELECT * FROM boat_routes WHERE boat_id = $1 AND route_id = $2;

-- name: ListBoatFacilities :many
SELECT * FROM boat_facilities WHERE boat_id = ANY(sqlc.arg(boat_ids)::uuid[]);

-- name: DeleteBoatFacilities :exec
DELETE FROM boat_facilities WHERE boat_id = $1;

-- name: InsertBoatFacility :exec
INSERT INTO boat_facilities (boat_id, facility_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: ListBoatsPublic :many
SELECT b.id, b.code, b.category_id, b.class_id, b.home_port_id, b.max_passengers, b.length_cm, b.cabins, b.overnight_allowed, b.sort_order,
    t.locale, t.name, t.slug, t.summary,
    COALESCE((SELECT min(br.price) FROM boat_rates br WHERE br.boat_id = b.id), 0)::bigint AS from_price,
    COALESCE((SELECT min(br.rate_unit) FROM boat_rates br WHERE br.boat_id = b.id AND br.price = (SELECT min(x.price) FROM boat_rates x WHERE x.boat_id = b.id)), '')::text AS from_unit,
    COALESCE((SELECT avg(rv.rating_overall)::numeric(3,2) FROM reviews rv WHERE rv.boat_id = b.id AND rv.status = 'PUBLISHED'), 0)::float8 AS rating,
    (SELECT count(*) FROM reviews rv WHERE rv.boat_id = b.id AND rv.status = 'PUBLISHED') AS review_count
FROM boats b
JOIN LATERAL (
    SELECT * FROM boat_translations bt WHERE bt.boat_id = b.id AND bt.locale IN (sqlc.arg(locale)::text, 'en')
    ORDER BY (bt.locale = sqlc.arg(locale)::text) DESC LIMIT 1
) t ON true
WHERE b.status = 'PUBLISHED'
  AND (sqlc.narg(region_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM boat_regions r WHERE r.boat_id = b.id AND r.region_id = sqlc.narg(region_id)))
  AND (sqlc.narg(category_id)::uuid IS NULL OR b.category_id = sqlc.narg(category_id))
  AND (sqlc.narg(class_id)::uuid IS NULL OR b.class_id = sqlc.narg(class_id))
  AND (sqlc.narg(route_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM boat_routes r WHERE r.boat_id = b.id AND r.route_id = sqlc.narg(route_id)))
  AND b.max_passengers >= sqlc.arg(min_pax)::int
  AND (sqlc.narg(ids)::uuid[] IS NULL OR b.id = ANY(sqlc.narg(ids)::uuid[]))
ORDER BY b.sort_order, t.name
LIMIT $1 OFFSET $2;

-- name: CountBoatsPublic :one
SELECT count(*) FROM boats b
WHERE b.status = 'PUBLISHED'
  AND (sqlc.narg(region_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM boat_regions r WHERE r.boat_id = b.id AND r.region_id = sqlc.narg(region_id)))
  AND (sqlc.narg(category_id)::uuid IS NULL OR b.category_id = sqlc.narg(category_id))
  AND (sqlc.narg(class_id)::uuid IS NULL OR b.class_id = sqlc.narg(class_id))
  AND (sqlc.narg(route_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM boat_routes r WHERE r.boat_id = b.id AND r.route_id = sqlc.narg(route_id)))
  AND b.max_passengers >= sqlc.arg(min_pax)::int
  AND (sqlc.narg(ids)::uuid[] IS NULL OR b.id = ANY(sqlc.narg(ids)::uuid[]));

-- Areas

-- name: ListAreas :many
SELECT a.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('name', t.name, 'description', t.description)) FROM area_translations t WHERE t.area_id = a.id), '{}')::jsonb AS translations,
    COALESCE((SELECT array_agg(f.facility_id) FROM area_facilities f WHERE f.area_id = a.id), '{}')::uuid[] AS facility_ids
FROM areas a WHERE a.boat_id = ANY(sqlc.arg(boat_ids)::uuid[]) ORDER BY a.boat_id, a.sort_order, a.created_at;

-- name: GetArea :one
SELECT * FROM areas WHERE id = $1;

-- name: InsertArea :one
INSERT INTO areas (boat_id, deck_label, is_system, min_pax, max_pax, base_price, sort_order, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: UpdateArea :one
UPDATE areas SET deck_label = $2, min_pax = $3, max_pax = $4, base_price = $5, sort_order = $6, status = $7, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: UpsertAreaTranslation :exec
INSERT INTO area_translations (area_id, locale, name, description) VALUES ($1, $2, $3, $4)
ON CONFLICT (area_id, locale) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- name: DeleteAreaFacilities :exec
DELETE FROM area_facilities WHERE area_id = $1;

-- name: InsertAreaFacility :exec
INSERT INTO area_facilities (area_id, facility_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CountAreaReferences :one
SELECT (SELECT count(*) FROM area_reservations ar WHERE ar.area_id = sqlc.arg(area_id)::uuid AND ar.kind <> 'BLOCK') + (SELECT count(*) FROM departure_slot_areas dsa WHERE dsa.area_id = sqlc.arg(area_id)::uuid);

-- name: DeleteArea :execrows
DELETE FROM areas WHERE id = $1 AND NOT is_system;

-- name: CountUserAreas :one
SELECT count(*) FROM areas WHERE boat_id = $1 AND NOT is_system;

-- name: SetSystemAreaStatus :exec
UPDATE areas SET status = $2, updated_at = now() WHERE boat_id = $1 AND is_system;

-- name: LockBoat :one
SELECT * FROM boats WHERE id = $1 FOR UPDATE;

-- Slug lookup and redirects

-- name: FindBoatBySlug :one
SELECT boat_id FROM boat_translations WHERE locale = $1 AND slug = $2;

-- name: FindRegionBySlug :one
SELECT region_id FROM region_translations WHERE locale = $1 AND slug = $2;

-- name: FindRouteBySlug :one
SELECT route_id FROM route_translations WHERE locale = $1 AND slug = $2;

-- name: InsertSlugRedirect :exec
INSERT INTO slug_redirects (entity_type, locale, old_slug, entity_id) VALUES ($1, $2, $3, $4)
ON CONFLICT (entity_type, locale, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, created_at = now();

-- name: DeleteSlugRedirect :exec
DELETE FROM slug_redirects WHERE entity_type = $1 AND locale = $2 AND old_slug = $3;

-- name: FindSlugRedirect :one
SELECT entity_id FROM slug_redirects WHERE entity_type = $1 AND locale = $2 AND old_slug = $3;

-- Policies

-- name: ListPaymentPolicies :many
SELECT * FROM payment_policies ORDER BY created_at;

-- name: GetPaymentPolicy :one
SELECT * FROM payment_policies WHERE id = $1;

-- name: InsertPaymentPolicy :one
INSERT INTO payment_policies (name, type, deposit_type, deposit_value, balance_due_days, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdatePaymentPolicy :one
UPDATE payment_policies SET name = $2, type = $3, deposit_type = $4, deposit_value = $5, balance_due_days = $6, status = $7, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListCancellationPolicies :many
SELECT p.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('min_days_before', t.min_days_before, 'refund_basis_points', t.refund_basis_points) ORDER BY t.min_days_before DESC) FROM cancellation_policy_tiers t WHERE t.policy_id = p.id), '[]')::jsonb AS tiers,
    COALESCE((SELECT jsonb_object_agg(t.locale, t.description) FROM cancellation_policy_translations t WHERE t.policy_id = p.id), '{}')::jsonb AS descriptions
FROM cancellation_policies p ORDER BY p.created_at;

-- name: GetCancellationPolicy :one
SELECT p.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('min_days_before', t.min_days_before, 'refund_basis_points', t.refund_basis_points) ORDER BY t.min_days_before DESC) FROM cancellation_policy_tiers t WHERE t.policy_id = p.id), '[]')::jsonb AS tiers,
    COALESCE((SELECT jsonb_object_agg(t.locale, t.description) FROM cancellation_policy_translations t WHERE t.policy_id = p.id), '{}')::jsonb AS descriptions
FROM cancellation_policies p WHERE p.id = $1;

-- name: InsertCancellationPolicy :one
INSERT INTO cancellation_policies (name, status) VALUES ($1, $2) RETURNING *;

-- name: UpdateCancellationPolicy :one
UPDATE cancellation_policies SET name = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteCancellationTiers :exec
DELETE FROM cancellation_policy_tiers WHERE policy_id = $1;

-- name: InsertCancellationTier :exec
INSERT INTO cancellation_policy_tiers (policy_id, min_days_before, refund_basis_points) VALUES ($1, $2, $3);

-- name: UpsertCancellationPolicyTranslation :exec
INSERT INTO cancellation_policy_translations (policy_id, locale, description) VALUES ($1, $2, $3)
ON CONFLICT (policy_id, locale) DO UPDATE SET description = EXCLUDED.description;

-- Sitemap

-- name: ListSitemapEntries :many
SELECT 'boat'::text AS kind, t.locale, t.slug, b.updated_at FROM boats b JOIN boat_translations t ON t.boat_id = b.id WHERE b.status = 'PUBLISHED'
UNION ALL
SELECT 'region', t.locale, t.slug, r.updated_at FROM regions r JOIN region_translations t ON t.region_id = r.id WHERE r.status = 'PUBLISHED'
UNION ALL
SELECT 'route', t.locale, t.slug, r.updated_at FROM routes r JOIN route_translations t ON t.route_id = r.id WHERE r.status = 'PUBLISHED'
UNION ALL
SELECT 'package', t.locale, t.slug, p.updated_at FROM packages p JOIN package_translations t ON t.package_id = p.id WHERE p.status = 'PUBLISHED' AND p.valid_until >= CURRENT_DATE
UNION ALL
SELECT 'page', t.locale, t.slug, p.updated_at FROM pages p JOIN page_translations t ON t.page_id = p.id WHERE p.status = 'PUBLISHED';
