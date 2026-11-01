-- name: ListBookingsToStart :many
SELECT id FROM bookings WHERE status = 'CONFIRMED' AND starts_at <= now() ORDER BY starts_at LIMIT 500;

-- name: ListBookingsToComplete :many
SELECT id FROM bookings WHERE status = 'IN_PROGRESS' AND ends_at <= now() ORDER BY ends_at LIMIT 500;

-- name: ListOverdueBalances :many
SELECT id FROM bookings WHERE status = 'CONFIRMED' AND payment_status = 'DEPOSIT_PAID' AND balance_due_at <= now() ORDER BY balance_due_at LIMIT 500;

-- name: ListBalanceReminderCandidates :many
SELECT id FROM bookings
WHERE status = 'CONFIRMED' AND payment_status = 'DEPOSIT_PAID'
  AND balance_due_at > now() + make_interval(days => sqlc.arg(days)::int - 1)
  AND balance_due_at <= now() + make_interval(days => sqlc.arg(days)::int)
LIMIT 1000;

-- name: ListTripReminderCandidates :many
SELECT id FROM bookings WHERE status = 'CONFIRMED' AND starts_at > now() AND starts_at <= now() + interval '24 hours' LIMIT 1000;

-- name: ListReviewRequestCandidates :many
SELECT b.id FROM bookings b
WHERE b.status = 'COMPLETED' AND b.ends_at <= now() - interval '24 hours' AND b.ends_at > now() - interval '72 hours'
  AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
LIMIT 1000;

-- name: PurgeExpiredIdentities :execrows
UPDATE booking_identities i SET ciphertext = NULL, key_id = NULL, purged_at = now()
FROM bookings b
WHERE b.id = i.booking_id AND i.purged_at IS NULL
  AND b.ends_at < now() - make_interval(days => sqlc.arg(days)::int)
  AND b.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED');

-- Reviews

-- name: InsertReview :one
INSERT INTO reviews (booking_id, user_id, boat_id, rating_overall, rating_boat, rating_service, rating_crew, title, body, locale)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: GetReviewByBooking :one
SELECT * FROM reviews WHERE booking_id = $1;

-- name: ModerateReview :one
UPDATE reviews SET status = $2, is_featured = $3, moderated_by = $4, moderated_at = now(), updated_at = now() WHERE id = $1 RETURNING *;

-- name: ListReviewsAdmin :many
SELECT r.*, u.full_name AS author_name, b.booking_number FROM reviews r JOIN users u ON u.id = r.user_id JOIN bookings b ON b.id = r.booking_id
WHERE (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status))
ORDER BY r.created_at DESC LIMIT $1 OFFSET $2;

-- name: ListReviewsPublic :many
SELECT r.id, r.boat_id, r.rating_overall, r.rating_boat, r.rating_service, r.rating_crew, r.title, r.body, r.locale, r.created_at, r.is_featured, u.full_name AS author_name, u.nationality AS author_country
FROM reviews r JOIN users u ON u.id = r.user_id
WHERE r.status = 'PUBLISHED'
  AND (sqlc.narg(boat_id)::uuid IS NULL OR r.boat_id = sqlc.narg(boat_id))
  AND (sqlc.arg(featured_only)::bool = false OR r.is_featured)
ORDER BY r.created_at DESC LIMIT $1 OFFSET $2;

-- name: ReviewStats :one
SELECT count(*)::bigint AS total, COALESCE(avg(rating_overall), 0)::float8 AS overall, COALESCE(avg(rating_boat), 0)::float8 AS boat,
    COALESCE(avg(rating_service), 0)::float8 AS service, COALESCE(avg(rating_crew), 0)::float8 AS crew
FROM reviews WHERE status = 'PUBLISHED' AND boat_id = $1;

-- Settlements

-- name: ListSettlementBookings :many
SELECT b.id, b.public_id, b.booking_number, b.status, b.subtotal, b.amount_paid, b.amount_refunded, b.forfeited_amount, b.starts_at, b.ends_at,
    b.snapshot, b.boat_id, pb.payout_id
FROM bookings b
JOIN boats bt ON bt.id = b.boat_id
LEFT JOIN payout_bookings pb ON pb.booking_id = b.id
WHERE bt.partner_id = $1
  AND b.ends_at >= sqlc.arg(period_start)::date AND b.ends_at < (sqlc.arg(period_end)::date + 1)
  AND (b.status = 'COMPLETED' OR (b.status = 'CANCELLED' AND b.forfeited_amount > 0))
ORDER BY b.ends_at;

-- name: InsertPayout :one
INSERT INTO payouts (partner_id, period_start, period_end, amount, paid_on, proof_media_id, notes, recorded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: InsertPayoutBooking :exec
INSERT INTO payout_bookings (payout_id, booking_id, partner_amount) VALUES ($1, $2, $3);

-- name: ListPayouts :many
SELECT p.*, pr.name AS partner_name FROM payouts p JOIN partners pr ON pr.id = p.partner_id
WHERE (sqlc.narg(partner_id)::uuid IS NULL OR p.partner_id = sqlc.narg(partner_id))
ORDER BY p.paid_on DESC LIMIT 500;

-- Reports and overview

-- name: RevenueByMethod :many
SELECT p.method, count(*)::bigint AS payments, COALESCE(sum(p.gross_amount), 0)::bigint AS gross,
    COALESCE((SELECT sum(r.amount) FROM refunds r JOIN payments px ON px.id = r.payment_id WHERE px.method = p.method AND r.status = 'COMPLETED'
        AND r.completed_at >= sqlc.arg(from_time)::timestamptz AND r.completed_at < sqlc.arg(to_time)::timestamptz), 0)::bigint AS refunded
FROM payments p
WHERE p.status = 'SUCCEEDED' AND p.paid_at >= sqlc.arg(from_time)::timestamptz AND p.paid_at < sqlc.arg(to_time)::timestamptz
GROUP BY p.method ORDER BY p.method;

-- name: ReportBookings :many
SELECT b.booking_number, b.status, b.payment_status, b.mode, b.starts_at, b.pax, b.grand_total, b.amount_paid, b.fees_paid, b.amount_refunded,
    b.lead_email, b.created_at, b.boat_id, b.package_id, b.route_id, b.snapshot
FROM bookings b
WHERE b.created_at >= sqlc.arg(from_time)::timestamptz AND b.created_at < sqlc.arg(to_time)::timestamptz
ORDER BY b.created_at LIMIT 20000;

-- name: ReportCancellations :many
SELECT b.booking_number, b.cancel_type, b.cancel_reason, b.cancelled_at, b.amount_paid, b.forfeited_amount, b.amount_refunded,
    (SELECT COALESCE(sum(r.amount), 0) FROM refunds r WHERE r.booking_id = b.id AND r.status <> 'REJECTED')::bigint AS refund_total
FROM bookings b
WHERE b.status = 'CANCELLED' AND b.cancelled_at >= sqlc.arg(from_time)::timestamptz AND b.cancelled_at < sqlc.arg(to_time)::timestamptz
ORDER BY b.cancelled_at LIMIT 20000;

-- name: OverviewCounts :one
SELECT
    (SELECT count(*) FROM bookings WHERE created_at >= sqlc.arg(day_start)::timestamptz)::bigint AS bookings_today,
    (SELECT count(*) FROM bookings WHERE created_at >= sqlc.arg(week_start)::timestamptz)::bigint AS bookings_week,
    (SELECT COALESCE(sum(gross_amount), 0) FROM payments WHERE status = 'SUCCEEDED' AND paid_at >= sqlc.arg(month_start)::timestamptz)::bigint AS revenue_month,
    (SELECT COALESCE(sum(amount), 0) FROM refunds WHERE status = 'COMPLETED' AND completed_at >= sqlc.arg(month_start)::timestamptz)::bigint AS refunds_month,
    (SELECT count(*) FROM payments WHERE status = 'PENDING')::bigint AS pending_payments,
    (SELECT count(*) FROM bookings WHERE exception_reason IS NOT NULL)::bigint AS exceptions,
    (SELECT count(*) FROM booking_requests WHERE status = 'PENDING')::bigint AS pending_requests,
    (SELECT count(*) FROM refunds WHERE status IN ('REQUESTED', 'APPROVED', 'PROCESSING'))::bigint AS open_refunds,
    (SELECT count(*) FROM reviews WHERE status = 'PENDING')::bigint AS pending_reviews;

-- name: UpcomingDepartures :many
SELECT b.id, b.public_id, b.booking_number, b.mode, b.status, b.starts_at, b.timezone, b.pax, b.snapshot
FROM bookings b WHERE b.status = 'CONFIRMED' AND b.starts_at > now() AND b.starts_at < now() + interval '7 days'
ORDER BY b.starts_at LIMIT 50;
