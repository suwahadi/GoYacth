-- Pricing inputs

-- name: GetBoatRate :one
SELECT * FROM boat_rates WHERE boat_id = $1 AND rate_unit = $2;

-- name: ListOverridesForRate :many
SELECT o.*, s.kind AS season_kind, s.starts_on AS season_starts_on, s.ends_on AS season_ends_on
FROM price_overrides o LEFT JOIN seasons s ON s.id = o.season_id
WHERE o.boat_rate_id = $1;

-- name: ListOverridesForOffering :many
SELECT o.*, s.kind AS season_kind, s.starts_on AS season_starts_on, s.ends_on AS season_ends_on
FROM price_overrides o LEFT JOIN seasons s ON s.id = o.season_id
WHERE o.package_offering_id = $1;

-- name: ListActiveTaxLines :many
SELECT t.*, COALESCE((SELECT jsonb_object_agg(x.locale, x.name) FROM tax_line_translations x WHERE x.tax_line_id = t.id), '{}')::jsonb AS names
FROM tax_lines t WHERE t.status = 'ACTIVE' ORDER BY t.sort_order, t.created_at;

-- name: GetPaymentMethodFee :one
SELECT * FROM payment_method_fees WHERE method = $1;

-- name: ListPaymentMethodFees :many
SELECT * FROM payment_method_fees ORDER BY sort_order, method;

-- name: UpsertPaymentMethodFee :exec
INSERT INTO payment_method_fees (method, fee_type, fee_value, hold_minutes, enabled, sort_order, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (method) DO UPDATE SET fee_type = EXCLUDED.fee_type, fee_value = EXCLUDED.fee_value, hold_minutes = EXCLUDED.hold_minutes,
    enabled = EXCLUDED.enabled, sort_order = EXCLUDED.sort_order, updated_at = now();

-- name: GetPromotionByCode :one
SELECT * FROM promotions WHERE upper(code) = upper(sqlc.arg(code)::text) AND status = 'ACTIVE';

-- name: ListAutomaticPromotions :many
SELECT * FROM promotions WHERE is_automatic AND status = 'ACTIVE' AND starts_at <= now() AND ends_at > now();

-- name: ReservePromotionQuota :execrows
UPDATE promotions SET used_count = used_count + 1, updated_at = now()
WHERE id = $1 AND status = 'ACTIVE' AND (quota IS NULL OR used_count < quota);

-- name: ReleasePromotionQuota :exec
UPDATE promotions SET used_count = GREATEST(used_count - 1, 0), updated_at = now() WHERE id = $1;

-- name: InsertPromotionRedemption :exec
INSERT INTO promotion_redemptions (promotion_id, booking_id, status) VALUES ($1, $2, 'HELD');

-- name: ReleasePromotionRedemptions :many
UPDATE promotion_redemptions SET status = 'RELEASED' WHERE booking_id = $1 AND status = 'HELD' RETURNING promotion_id;

-- name: UsePromotionRedemptions :exec
UPDATE promotion_redemptions SET status = 'USED' WHERE booking_id = $1 AND status = 'HELD';

-- Seasons, overrides, promotions, taxes (admin)

-- name: ListSeasons :many
SELECT * FROM seasons ORDER BY starts_on DESC LIMIT 500;

-- name: InsertSeason :one
INSERT INTO seasons (name, kind, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdateSeason :one
UPDATE seasons SET name = $2, kind = $3, starts_on = $4, ends_on = $5 WHERE id = $1 RETURNING *;

-- name: DeleteSeason :execrows
DELETE FROM seasons WHERE id = $1;

-- name: ListPriceOverrides :many
SELECT * FROM price_overrides
WHERE (sqlc.narg(boat_rate_id)::uuid IS NULL OR boat_rate_id = sqlc.narg(boat_rate_id))
  AND (sqlc.narg(package_offering_id)::uuid IS NULL OR package_offering_id = sqlc.narg(package_offering_id))
ORDER BY rule_type, on_date NULLS LAST LIMIT 1000;

-- name: InsertPriceOverride :one
INSERT INTO price_overrides (boat_rate_id, package_offering_id, rule_type, on_date, season_id, price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: DeletePriceOverride :execrows
DELETE FROM price_overrides WHERE id = $1;

-- name: ListPromotions :many
SELECT * FROM promotions ORDER BY created_at DESC LIMIT 500;

-- name: InsertPromotion :one
INSERT INTO promotions (name, code, is_automatic, discount_type, discount_value, boat_id, package_id, booking_mode, min_subtotal, starts_at, ends_at, quota, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;

-- name: UpdatePromotion :one
UPDATE promotions SET name = $2, code = $3, is_automatic = $4, discount_type = $5, discount_value = $6, boat_id = $7, package_id = $8,
    booking_mode = $9, min_subtotal = $10, starts_at = $11, ends_at = $12, quota = $13, status = $14, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListTaxLinesAdmin :many
SELECT t.*, COALESCE((SELECT jsonb_object_agg(x.locale, x.name) FROM tax_line_translations x WHERE x.tax_line_id = t.id), '{}')::jsonb AS names
FROM tax_lines t ORDER BY t.sort_order, t.created_at;

-- name: InsertTaxLine :one
INSERT INTO tax_lines (code, basis_points, includes_previous_lines, sort_order, status) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateTaxLine :one
UPDATE tax_lines SET code = $2, basis_points = $3, includes_previous_lines = $4, sort_order = $5, status = $6, updated_at = now() WHERE id = $1 RETURNING *;

-- name: UpsertTaxLineTranslation :exec
INSERT INTO tax_line_translations (tax_line_id, locale, name) VALUES ($1, $2, $3)
ON CONFLICT (tax_line_id, locale) DO UPDATE SET name = EXCLUDED.name;

-- Departures

-- name: InsertDeparture :one
INSERT INTO departures (boat_id, route_id, departs_at, returns_at, booking_closes_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetDeparture :one
SELECT * FROM departures WHERE id = $1;

-- name: LockDeparture :one
SELECT * FROM departures WHERE id = $1 FOR UPDATE;

-- name: UpdateDepartureClose :one
UPDATE departures SET booking_closes_at = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: CancelDeparture :one
UPDATE departures SET status = 'CANCELLED', cancel_reason = $2, updated_at = now() WHERE id = $1 AND status = 'SCHEDULED' RETURNING *;

-- name: ListDeparturesAdmin :many
SELECT d.*, (SELECT COALESCE(sum(b.pax), 0) FROM bookings b WHERE b.departure_id = d.id AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'))::bigint AS booked_pax
FROM departures d
WHERE (sqlc.narg(boat_id)::uuid IS NULL OR d.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR d.departs_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR d.departs_at < sqlc.narg(to_time))
ORDER BY d.departs_at
LIMIT $1 OFFSET $2;

-- name: ListDeparturesPublic :many
SELECT d.* FROM departures d JOIN boats b ON b.id = d.boat_id AND b.status = 'PUBLISHED'
WHERE d.status = 'SCHEDULED' AND d.booking_closes_at > now() AND d.departs_at > now()
  AND (sqlc.narg(boat_id)::uuid IS NULL OR d.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(route_id)::uuid IS NULL OR d.route_id = sqlc.narg(route_id))
  AND (sqlc.narg(departure_id)::uuid IS NULL OR d.id = sqlc.narg(departure_id))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR d.departs_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR d.departs_at < sqlc.narg(to_time))
ORDER BY d.departs_at
LIMIT $1;

-- name: InsertDepartureSlot :one
INSERT INTO departure_slots (departure_id, slot_type, price, seat_capacity, min_pax, max_pax, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: InsertDepartureSlotArea :exec
INSERT INTO departure_slot_areas (departure_id, slot_id, area_id) VALUES ($1, $2, $3);

-- name: ListDepartureSlots :many
SELECT s.*, COALESCE((SELECT array_agg(a.area_id) FROM departure_slot_areas a WHERE a.slot_id = s.id), '{}')::uuid[] AS area_ids,
    (SELECT COALESCE(sum(b.pax), 0) FROM bookings b WHERE b.departure_slot_id = s.id AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'))::bigint AS booked_pax,
    (SELECT count(*) FROM bookings b WHERE b.departure_slot_id = s.id AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'))::bigint AS booking_count
FROM departure_slots s WHERE s.departure_id = ANY(sqlc.arg(departure_ids)::uuid[]) ORDER BY s.departure_id, s.sort_order;

-- name: GetDepartureSlot :one
SELECT * FROM departure_slots WHERE id = $1;

-- name: UpdateDepartureSlotPrice :exec
UPDATE departure_slots SET price = $2, max_pax = $3 WHERE id = $1;

-- name: SumDeparturePax :one
SELECT COALESCE(sum(pax), 0)::bigint FROM bookings WHERE departure_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');

-- name: SumSlotPax :one
SELECT COALESCE(sum(pax), 0)::bigint FROM bookings WHERE departure_slot_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');

-- Inventory

-- name: ListBoatAreaIDs :many
SELECT id FROM areas WHERE boat_id = $1 ORDER BY id;

-- name: InsertAreaReservation :exec
INSERT INTO area_reservations (area_id, boat_id, period, kind, booking_id, departure_id, block_id, status, expires_at)
VALUES ($1, $2, tstzrange(sqlc.arg(starts_at)::timestamptz, sqlc.arg(ends_at)::timestamptz, '[)'), $3, $4, $5, $6, $7, $8);

-- name: ListExpiredHeldOverlapping :many
SELECT DISTINCT booking_id FROM area_reservations
WHERE boat_id = $1 AND status = 'HELD' AND expires_at <= now()
  AND period && tstzrange(sqlc.arg(starts_at)::timestamptz, sqlc.arg(ends_at)::timestamptz, '[)')
  AND booking_id IS NOT NULL;

-- name: ListExpiredPendingBookings :many
SELECT id FROM bookings WHERE status = 'PENDING_PAYMENT' AND hold_expires_at <= now() ORDER BY hold_expires_at LIMIT 500;

-- name: ListExpiredPendingOnDeparture :many
SELECT id FROM bookings WHERE departure_id = $1 AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now();

-- name: DeleteBookingReservations :exec
DELETE FROM area_reservations WHERE booking_id = $1;

-- name: ActivateBookingReservations :execrows
UPDATE area_reservations SET status = 'ACTIVE', expires_at = NULL WHERE booking_id = $1;

-- name: CountBookingReservations :one
SELECT count(*) FROM area_reservations WHERE booking_id = $1;

-- name: DeleteDepartureReservations :exec
DELETE FROM area_reservations WHERE departure_id = $1;

-- name: InsertBoatBlock :one
INSERT INTO boat_blocks (boat_id, area_id, kind, starts_at, ends_at, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: ListBoatBlocks :many
SELECT * FROM boat_blocks WHERE boat_id = $1 AND ends_at > sqlc.arg(from_time)::timestamptz ORDER BY starts_at LIMIT 500;

-- name: GetBoatBlock :one
SELECT * FROM boat_blocks WHERE id = $1;

-- name: DeleteBoatBlock :execrows
DELETE FROM boat_blocks WHERE id = $1;

-- name: ListBoatReservations :many
SELECT r.id, r.area_id, r.kind, r.status, r.booking_id, r.departure_id, r.block_id, r.expires_at,
    lower(r.period)::timestamptz AS starts_at, upper(r.period)::timestamptz AS ends_at, b.public_id AS booking_public_id
FROM area_reservations r LEFT JOIN bookings b ON b.id = r.booking_id
WHERE r.boat_id = ANY(sqlc.arg(boat_ids)::uuid[])
  AND r.period && tstzrange(sqlc.arg(from_time)::timestamptz, sqlc.arg(to_time)::timestamptz, '[)')
  AND (r.status = 'ACTIVE' OR r.expires_at > now())
ORDER BY lower(r.period)
LIMIT 5000;

-- name: ListBoatsBasic :many
SELECT b.id, b.code, b.status, b.max_passengers, b.turnaround_buffer_minutes, t.name
FROM boats b JOIN boat_translations t ON t.boat_id = b.id AND t.locale = 'en'
WHERE b.status <> 'ARCHIVED' ORDER BY b.sort_order, t.name;

-- Packages

-- name: ListPackagesAdmin :many
SELECT p.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'package_id' - 'locale') FROM package_translations t WHERE t.package_id = p.id), '{}')::jsonb AS translations
FROM packages p ORDER BY p.sort_order, p.created_at DESC LIMIT 500;

-- name: GetPackageAdmin :one
SELECT p.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'package_id' - 'locale') FROM package_translations t WHERE t.package_id = p.id), '{}')::jsonb AS translations
FROM packages p WHERE p.id = $1;

-- name: GetPackage :one
SELECT * FROM packages WHERE id = $1;

-- name: InsertPackage :one
INSERT INTO packages (mode, route_id, duration_minutes, departure_id, min_pax, max_pax, valid_from, valid_until, booking_cutoff_hours,
    payment_policy_id, cancellation_policy_id, sort_order, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;

-- name: UpdatePackage :one
UPDATE packages SET mode = $2, route_id = $3, duration_minutes = $4, departure_id = $5, min_pax = $6, max_pax = $7, valid_from = $8,
    valid_until = $9, booking_cutoff_hours = $10, payment_policy_id = $11, cancellation_policy_id = $12, sort_order = $13, status = $14, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: GetPackageTranslation :one
SELECT * FROM package_translations WHERE package_id = $1 AND locale = $2;

-- name: UpsertPackageTranslation :exec
INSERT INTO package_translations (package_id, locale, name, slug, summary, description, inclusions, exclusions, seo_title, seo_description)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (package_id, locale) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, summary = EXCLUDED.summary, description = EXCLUDED.description,
    inclusions = EXCLUDED.inclusions, exclusions = EXCLUDED.exclusions, seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description;

-- name: FindPackageBySlug :one
SELECT package_id FROM package_translations WHERE locale = $1 AND slug = $2;

-- name: ListPackageOfferings :many
SELECT * FROM package_offerings WHERE package_id = ANY(sqlc.arg(package_ids)::uuid[]) ORDER BY package_id, price;

-- name: GetPackageOffering :one
SELECT * FROM package_offerings WHERE id = $1;

-- name: DeletePackageOfferingsExcept :exec
DELETE FROM package_offerings WHERE package_id = $1 AND NOT (id = ANY(sqlc.arg(keep)::uuid[]));

-- name: InsertPackageOffering :one
INSERT INTO package_offerings (package_id, boat_id, departure_slot_id, price) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdatePackageOffering :exec
UPDATE package_offerings SET boat_id = $2, departure_slot_id = $3, price = $4 WHERE id = $1 AND package_id = $5;

-- name: CountPackageBookings :one
SELECT count(*) FROM bookings WHERE package_id = $1;

-- name: DeletePackage :execrows
DELETE FROM packages WHERE id = $1;

-- name: ListPackagesPublic :many
SELECT p.id, p.mode, p.route_id, p.duration_minutes, p.departure_id, p.min_pax, p.max_pax, p.valid_from, p.valid_until, p.sort_order,
    t.name, t.slug, t.summary,
    COALESCE((SELECT min(o.price) FROM package_offerings o WHERE o.package_id = p.id), 0)::bigint AS from_price
FROM packages p
JOIN LATERAL (
    SELECT * FROM package_translations pt WHERE pt.package_id = p.id AND pt.locale IN (sqlc.arg(locale)::text, 'en')
    ORDER BY (pt.locale = sqlc.arg(locale)::text) DESC LIMIT 1
) t ON true
WHERE p.status = 'PUBLISHED' AND p.valid_until >= CURRENT_DATE
  AND (sqlc.narg(ids)::uuid[] IS NULL OR p.id = ANY(sqlc.narg(ids)::uuid[]))
ORDER BY p.sort_order, p.valid_from
LIMIT $1 OFFSET $2;

-- Bookings

-- name: InsertBooking :one
INSERT INTO bookings (booking_number, user_id, mode, package_id, boat_id, route_id, departure_id, departure_slot_id, is_private_slot,
    starts_at, ends_at, timezone, pax, payment_scheme, subtotal, grand_total, deposit_amount, hold_expires_at, balance_due_at,
    snapshot, consents, lead_full_name, lead_email, lead_phone, lead_nationality, special_request, locale, verify_token, created_by_admin)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
RETURNING *;

-- name: InsertBookingGuest :exec
INSERT INTO booking_guests (booking_id, sort_order, full_name, phone) VALUES ($1, $2, $3, $4);

-- name: InsertBookingIdentity :exec
INSERT INTO booking_identities (booking_id, id_type, ciphertext, key_id, last4) VALUES ($1, $2, $3, $4, $5);

-- name: GetBooking :one
SELECT * FROM bookings WHERE id = $1;

-- name: GetBookingByPublicID :one
SELECT * FROM bookings WHERE public_id = $1;

-- name: GetBookingByNumber :one
SELECT * FROM bookings WHERE booking_number = $1;

-- name: GetBookingByVerifyToken :one
SELECT * FROM bookings WHERE verify_token = $1;

-- name: LockBooking :one
SELECT * FROM bookings WHERE id = $1 FOR UPDATE;

-- name: SetBookingStatus :one
UPDATE bookings SET status = sqlc.arg(status)::text, updated_at = now(),
    hold_expires_at = CASE WHEN sqlc.arg(status)::text = 'PENDING_PAYMENT' THEN hold_expires_at ELSE NULL END
WHERE id = sqlc.arg(id) RETURNING *;

-- name: CancelBookingRow :one
UPDATE bookings SET status = 'CANCELLED', cancel_type = $2, cancel_reason = $3, cancelled_at = now(), hold_expires_at = NULL,
    verify_token_revoked = true, forfeited_amount = $4, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListBookingGuests :many
SELECT * FROM booking_guests WHERE booking_id = ANY(sqlc.arg(booking_ids)::uuid[]) ORDER BY booking_id, sort_order;

-- name: DeleteBookingGuests :exec
DELETE FROM booking_guests WHERE booking_id = $1;

-- name: GetBookingIdentity :one
SELECT * FROM booking_identities WHERE booking_id = $1;

-- name: ListBookingIdentities :many
SELECT * FROM booking_identities WHERE booking_id = ANY(sqlc.arg(booking_ids)::uuid[]);

-- name: ListUserBookings :many
SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: CountUserBookings :one
SELECT count(*) FROM bookings WHERE user_id = $1;

-- name: ListBookingsAdmin :many
SELECT * FROM bookings b
WHERE (sqlc.narg(status)::text IS NULL OR b.status = sqlc.narg(status))
  AND (sqlc.narg(payment_status)::text IS NULL OR b.payment_status = sqlc.narg(payment_status))
  AND (sqlc.narg(boat_id)::uuid IS NULL OR b.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(departure_id)::uuid IS NULL OR b.departure_id = sqlc.narg(departure_id))
  AND (sqlc.narg(user_id)::uuid IS NULL OR b.user_id = sqlc.narg(user_id))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR b.starts_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR b.starts_at < sqlc.narg(to_time))
  AND (sqlc.narg(search)::text IS NULL OR b.booking_number = upper(sqlc.narg(search)) OR b.lead_email ILIKE '%' || sqlc.narg(search) || '%' OR b.lead_full_name ILIKE '%' || sqlc.narg(search) || '%')
  AND (sqlc.arg(exceptions_only)::bool = false OR b.exception_reason IS NOT NULL)
ORDER BY b.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountBookingsAdmin :one
SELECT count(*) FROM bookings b
WHERE (sqlc.narg(status)::text IS NULL OR b.status = sqlc.narg(status))
  AND (sqlc.narg(payment_status)::text IS NULL OR b.payment_status = sqlc.narg(payment_status))
  AND (sqlc.narg(boat_id)::uuid IS NULL OR b.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(departure_id)::uuid IS NULL OR b.departure_id = sqlc.narg(departure_id))
  AND (sqlc.narg(user_id)::uuid IS NULL OR b.user_id = sqlc.narg(user_id))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR b.starts_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR b.starts_at < sqlc.narg(to_time))
  AND (sqlc.narg(search)::text IS NULL OR b.booking_number = upper(sqlc.narg(search)) OR b.lead_email ILIKE '%' || sqlc.narg(search) || '%' OR b.lead_full_name ILIKE '%' || sqlc.narg(search) || '%')
  AND (sqlc.arg(exceptions_only)::bool = false OR b.exception_reason IS NOT NULL);

-- name: ListActiveDepartureBookings :many
SELECT * FROM bookings WHERE departure_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED') ORDER BY created_at;

-- name: SetBookingException :exec
UPDATE bookings SET exception_reason = $2, updated_at = now() WHERE id = $1;

-- name: ClearBookingException :exec
UPDATE bookings SET exception_reason = NULL, updated_at = now() WHERE id = $1;

-- name: CountDeparturesAdmin :one
SELECT count(*) FROM departures d
WHERE (sqlc.narg(boat_id)::uuid IS NULL OR d.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR d.departs_at >= sqlc.narg(from_time))
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR d.departs_at < sqlc.narg(to_time));
