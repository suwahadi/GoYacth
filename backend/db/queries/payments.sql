-- name: CancelPendingPayments :many
UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE booking_id = $1 AND status = 'PENDING' RETURNING *;

-- name: InsertPayment :one
INSERT INTO payments (booking_id, kind, provider, method, order_id, principal_amount, fee_amount, gross_amount, status, expires_at, paid_at,
    manual_paid_on, proof_media_id, recorded_by, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING *;

-- name: SetPaymentSnap :one
UPDATE payments SET snap_token = $2, snap_redirect_url = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: GetPaymentByOrderID :one
SELECT * FROM payments WHERE order_id = $1;

-- name: LockPaymentByOrderID :one
SELECT * FROM payments WHERE order_id = $1 FOR UPDATE;

-- name: GetPayment :one
SELECT * FROM payments WHERE id = $1;

-- name: GetPendingPayment :one
SELECT * FROM payments WHERE booking_id = $1 AND status = 'PENDING';

-- name: ListBookingPayments :many
SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at;

-- name: UpdatePaymentFromProvider :one
UPDATE payments SET status = $2, provider_status = $3, provider_fraud = $4, provider_txn_id = $5, provider_payment_type = $6,
    va_numbers = $7, paid_at = COALESCE(paid_at, sqlc.narg(paid_at)), is_exception = is_exception OR sqlc.arg(is_exception)::bool, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: InsertPaymentEvent :one
INSERT INTO payment_events (payment_id, order_id, dedupe_key, source, transaction_status, fraud_status, status_code, gross_amount, verdict, verdict_reason, payload)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (dedupe_key) DO NOTHING
RETURNING id;

-- name: ListPaymentEvents :many
SELECT * FROM payment_events
WHERE (sqlc.narg(order_id)::text IS NULL OR order_id = sqlc.narg(order_id))
ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: ListStalePendingProviderPayments :many
SELECT * FROM payments WHERE status = 'PENDING' AND provider = 'MIDTRANS' AND created_at < now() - interval '5 minutes' ORDER BY created_at LIMIT 200;

-- name: ApplyBookingPayment :one
UPDATE bookings SET amount_paid = amount_paid + sqlc.arg(principal)::bigint, fees_paid = fees_paid + sqlc.arg(fee)::bigint,
    payment_status = sqlc.arg(payment_status)::text, status = sqlc.arg(status)::text,
    hold_expires_at = CASE WHEN sqlc.arg(status)::text = 'PENDING_PAYMENT' THEN hold_expires_at ELSE NULL END,
    invoice_number = COALESCE(invoice_number, sqlc.narg(invoice_number)), updated_at = now()
WHERE id = sqlc.arg(id) RETURNING *;

-- name: NextInvoiceNumber :one
INSERT INTO invoice_sequences (year, last_value) VALUES ($1, 1)
ON CONFLICT (year) DO UPDATE SET last_value = invoice_sequences.last_value + 1
RETURNING last_value;

-- name: ListPaymentsAdmin :many
SELECT p.*, b.booking_number, b.public_id AS booking_public_id FROM payments p JOIN bookings b ON b.id = p.booking_id
WHERE (sqlc.narg(status)::text IS NULL OR p.status = sqlc.narg(status))
  AND (sqlc.narg(method)::text IS NULL OR p.method = sqlc.narg(method))
  AND (sqlc.arg(exceptions_only)::bool = false OR p.is_exception)
ORDER BY p.created_at DESC LIMIT $1 OFFSET $2;

-- name: CountPaymentsAdmin :one
SELECT count(*) FROM payments p
WHERE (sqlc.narg(status)::text IS NULL OR p.status = sqlc.narg(status))
  AND (sqlc.narg(method)::text IS NULL OR p.method = sqlc.narg(method))
  AND (sqlc.arg(exceptions_only)::bool = false OR p.is_exception);

-- Refunds

-- name: InsertRefund :one
INSERT INTO refunds (booking_id, payment_id, reason_type, amount, includes_fee_amount, channel, status, bank_name, bank_account_name, bank_account_number, notes, requested_by, approved_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;

-- name: GetRefund :one
SELECT * FROM refunds WHERE id = $1;

-- name: LockRefund :one
SELECT * FROM refunds WHERE id = $1 FOR UPDATE;

-- name: UpdateRefundStatus :one
UPDATE refunds SET status = $2, provider_refund_key = COALESCE(sqlc.narg(provider_refund_key), provider_refund_key),
    proof_media_id = COALESCE(sqlc.narg(proof_media_id), proof_media_id), approved_by = COALESCE(sqlc.narg(approved_by), approved_by),
    notes = CASE WHEN sqlc.arg(notes)::text = '' THEN notes ELSE sqlc.arg(notes)::text END,
    completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: SetRefundBankDetails :one
UPDATE refunds SET bank_name = $2, bank_account_name = $3, bank_account_number = $4, updated_at = now()
WHERE id = $1 AND channel = 'MANUAL' AND status IN ('REQUESTED', 'APPROVED') RETURNING *;

-- name: ListBookingRefunds :many
SELECT * FROM refunds WHERE booking_id = $1 ORDER BY created_at;

-- name: ListRefundsAdmin :many
SELECT r.*, b.booking_number, b.public_id AS booking_public_id FROM refunds r JOIN bookings b ON b.id = r.booking_id
WHERE (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status))
ORDER BY r.created_at DESC LIMIT $1 OFFSET $2;

-- name: CountRefundsAdmin :one
SELECT count(*) FROM refunds r WHERE (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status));

-- name: SumCompletedRefunds :one
SELECT COALESCE(sum(amount), 0)::bigint FROM refunds WHERE booking_id = $1 AND status = 'COMPLETED';

-- name: SumOpenRefunds :one
SELECT COALESCE(sum(amount), 0)::bigint FROM refunds WHERE booking_id = $1 AND status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED');

-- name: SetBookingRefunded :one
UPDATE bookings SET amount_refunded = $2, payment_status = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- Booking requests

-- name: InsertBookingRequest :one
INSERT INTO booking_requests (booking_id, type, message) VALUES ($1, $2, $3) RETURNING *;

-- name: ListBookingRequests :many
SELECT * FROM booking_requests WHERE booking_id = $1 ORDER BY created_at;

-- name: LockBookingRequest :one
SELECT * FROM booking_requests WHERE id = $1 FOR UPDATE;

-- name: ResolveBookingRequest :one
UPDATE booking_requests SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING *;

-- name: ListPendingRequests :many
SELECT r.*, b.booking_number, b.public_id AS booking_public_id FROM booking_requests r JOIN bookings b ON b.id = r.booking_id
WHERE r.status = 'PENDING' ORDER BY r.created_at LIMIT 200;
