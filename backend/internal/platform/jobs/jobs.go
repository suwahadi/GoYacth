// Package jobs declares every background job argument type in one place so modules can enqueue
// each other's work without importing each other.
package jobs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

type Enqueuer interface {
	EnqueueTx(ctx context.Context, tx pgx.Tx, args river.JobArgs) error
}

// RiverEnqueuer is created before the River client exists, because River's worker set is built
// from services that themselves need to enqueue jobs. SetClient must be called before use.
type RiverEnqueuer struct {
	client *river.Client[pgx.Tx]
}

func (e *RiverEnqueuer) SetClient(c *river.Client[pgx.Tx]) { e.client = c }

func (e *RiverEnqueuer) EnqueueTx(ctx context.Context, tx pgx.Tx, args river.JobArgs) error {
	_, err := e.client.InsertTx(ctx, tx, args, nil)
	return err
}

const (
	QueueDefault = river.QueueDefault
	QueueMedia   = "media"
	QueueEmail   = "email"
)

func unique() river.UniqueOpts { return river.UniqueOpts{ByArgs: true} }

type SendWelcome struct {
	UserID uuid.UUID `json:"user_id"`
}

func (SendWelcome) Kind() string { return "send_welcome" }
func (SendWelcome) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueEmail, MaxAttempts: 10, UniqueOpts: unique()}
}

// SendAuthEmail mails a confirmation or password link. Template is verify_email, password_reset
// or account_exists. Token is the raw value; only its hash is stored, and it expires within two days.
type SendAuthEmail struct {
	UserID   uuid.UUID `json:"user_id"`
	Template string    `json:"template"`
	Token    string    `json:"token"`
	ReturnTo string    `json:"return_to,omitempty"`
}

func (SendAuthEmail) Kind() string { return "send_auth_email" }
func (SendAuthEmail) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueEmail, MaxAttempts: 10, UniqueOpts: unique()}
}

// Notify sends one templated email. DedupeKey is unique in notification_logs, so a retried or
// duplicated job never sends the same message twice.
type Notify struct {
	Template  string     `json:"template"`
	BookingID *uuid.UUID `json:"booking_id,omitempty"`
	RefundID  *uuid.UUID `json:"refund_id,omitempty"`
	DedupeKey string     `json:"dedupe_key"`
	Audience  string     `json:"audience"`
}

func (Notify) Kind() string { return "notify" }
func (Notify) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueEmail, MaxAttempts: 12, UniqueOpts: unique()}
}

const (
	AudienceCustomer = "CUSTOMER"
	AudienceAdmin    = "ADMIN"
)

type ProcessMedia struct {
	MediaID uuid.UUID `json:"media_id"`
	Slug    string    `json:"slug"`
}

func (ProcessMedia) Kind() string { return "process_media" }
func (ProcessMedia) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueMedia, MaxAttempts: 3, UniqueOpts: unique()}
}

type DeleteMedia struct {
	MediaIDs []uuid.UUID `json:"media_ids"`
}

func (DeleteMedia) Kind() string { return "delete_media" }
func (DeleteMedia) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueMedia, MaxAttempts: 10, ScheduledAt: time.Now().Add(time.Minute)}
}

type ExpireHolds struct{}

func (ExpireHolds) Kind() string { return "expire_holds" }

type AdvanceBookings struct{}

func (AdvanceBookings) Kind() string { return "advance_bookings" }

type CancelOverdueBalances struct{}

func (CancelOverdueBalances) Kind() string { return "cancel_overdue_balances" }

type BalanceReminders struct{}

func (BalanceReminders) Kind() string { return "balance_reminders" }

type ReconcilePayments struct{}

func (ReconcilePayments) Kind() string { return "reconcile_payments" }

type TripReminders struct{}

func (TripReminders) Kind() string { return "trip_reminders" }

type PurgeIdentities struct{}

func (PurgeIdentities) Kind() string { return "purge_identities" }

type CleanupMedia struct{}

func (CleanupMedia) Kind() string { return "cleanup_media" }

type CleanupHousekeeping struct{}

func (CleanupHousekeeping) Kind() string { return "cleanup_housekeeping" }

type RefundProvider struct {
	RefundID uuid.UUID `json:"refund_id"`
}

func (RefundProvider) Kind() string { return "refund_provider" }
func (RefundProvider) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 8, UniqueOpts: unique()}
}
