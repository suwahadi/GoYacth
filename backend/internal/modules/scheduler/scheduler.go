// Package scheduler contains the bodies of the periodic jobs in PRD 15.2. Each function is
// idempotent: it selects rows by state, locks them, re-checks the state and only then acts, so
// overlapping runs on several workers cannot double-apply anything.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/refunds"
	"goyacht/internal/modules/settings"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/jobs"
)

type Service struct {
	pool    *pgxpool.Pool
	refunds *refunds.Service
	enqueue jobs.Enqueuer
	now     func() time.Time
}

func New(pool *pgxpool.Pool, rf *refunds.Service, enqueue jobs.Enqueuer) *Service {
	return &Service{pool: pool, refunds: rf, enqueue: enqueue, now: time.Now}
}

func (s *Service) each(ctx context.Context, ids []uuid.UUID, fn func(tx pgx.Tx, id uuid.UUID) error) error {
	var firstErr error
	for _, id := range ids {
		if err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error { return fn(tx, id) }); err != nil {
			slog.ErrorContext(ctx, "scheduled job item failed", "error", err, "booking_id", id)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// ExpireHolds turns unpaid bookings past their hold into EXPIRED and frees their inventory.
func (s *Service) ExpireHolds(ctx context.Context) error {
	ids, err := dbq.New(s.pool).ListExpiredPendingBookings(ctx)
	if err != nil {
		return err
	}
	return s.each(ctx, ids, func(tx pgx.Tx, id uuid.UUID) error {
		_, err := bookings.ExpireIfStale(ctx, dbq.New(tx), id, s.now())
		return err
	})
}

func (s *Service) transition(ctx context.Context, tx pgx.Tx, id uuid.UUID, from, to bookings.Status) error {
	q := dbq.New(tx)
	b, err := q.LockBooking(ctx, id)
	if err != nil {
		return err
	}
	if bookings.Status(b.Status) != from {
		return nil
	}
	if err := bookings.CheckTransition(from, to); err != nil {
		return err
	}
	_, err = q.SetBookingStatus(ctx, dbq.SetBookingStatusParams{ID: id, Status: string(to)})
	return err
}

// AdvanceBookings moves CONFIRMED bookings to IN_PROGRESS at departure and to COMPLETED at return.
func (s *Service) AdvanceBookings(ctx context.Context) error {
	q := dbq.New(s.pool)
	start, err := q.ListBookingsToStart(ctx)
	if err != nil {
		return err
	}
	if err := s.each(ctx, start, func(tx pgx.Tx, id uuid.UUID) error {
		return s.transition(ctx, tx, id, bookings.StatusConfirmed, bookings.StatusInProgress)
	}); err != nil {
		return err
	}
	done, err := q.ListBookingsToComplete(ctx)
	if err != nil {
		return err
	}
	return s.each(ctx, done, func(tx pgx.Tx, id uuid.UUID) error {
		return s.transition(ctx, tx, id, bookings.StatusInProgress, bookings.StatusCompleted)
	})
}

// CancelOverdueBalances cancels deposit bookings whose balance deadline passed; the deposit is
// forfeited (PRD 9.4) and the customer is emailed once through the cancellation notification.
func (s *Service) CancelOverdueBalances(ctx context.Context) error {
	ids, err := dbq.New(s.pool).ListOverdueBalances(ctx)
	if err != nil {
		return err
	}
	return s.each(ctx, ids, func(tx pgx.Tx, id uuid.UUID) error {
		b, err := dbq.New(tx).LockBooking(ctx, id)
		if err != nil {
			return err
		}
		if b.Status != string(bookings.StatusConfirmed) || b.PaymentStatus != string(bookings.PayDepositPaid) || b.BalanceDueAt == nil || b.BalanceDueAt.After(s.now()) {
			return nil
		}
		return s.refunds.Cancel(ctx, tx, id, bookings.CancelBalanceOverdue, "balance not paid before the deadline", nil)
	})
}

func (s *Service) notify(ctx context.Context, ids []uuid.UUID, template string, key func(uuid.UUID) string) error {
	return s.each(ctx, ids, func(tx pgx.Tx, id uuid.UUID) error {
		bid := id
		return s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: template, BookingID: &bid, DedupeKey: key(id), Audience: jobs.AudienceCustomer})
	})
}

func (s *Service) BalanceReminders(ctx context.Context) error {
	q := dbq.New(s.pool)
	cfg, err := settings.Load(ctx, q, "booking", settings.DefaultBooking())
	if err != nil {
		return err
	}
	for _, d := range cfg.BalanceReminderDays {
		if d < 1 {
			continue
		}
		ids, err := q.ListBalanceReminderCandidates(ctx, int32(d))
		if err != nil {
			return err
		}
		days := d
		if err := s.notify(ctx, ids, "balance_reminder", func(id uuid.UUID) string { return fmt.Sprintf("balance_reminder:%s:%d", id, days) }); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) TripReminders(ctx context.Context) error {
	q := dbq.New(s.pool)
	trip, err := q.ListTripReminderCandidates(ctx)
	if err != nil {
		return err
	}
	if err := s.notify(ctx, trip, "trip_reminder", func(id uuid.UUID) string { return "trip_reminder:" + id.String() }); err != nil {
		return err
	}
	review, err := q.ListReviewRequestCandidates(ctx)
	if err != nil {
		return err
	}
	return s.notify(ctx, review, "review_request", func(id uuid.UUID) string { return "review_request:" + id.String() })
}

// PurgeIdentities deletes encrypted identity numbers after the retention period (PRD 18.2).
func (s *Service) PurgeIdentities(ctx context.Context) error {
	q := dbq.New(s.pool)
	cfg, err := settings.Load(ctx, q, "booking", settings.DefaultBooking())
	if err != nil {
		return err
	}
	n, err := q.PurgeExpiredIdentities(ctx, int32(cfg.IdentityRetentionDays))
	if err != nil {
		return err
	}
	if n > 0 {
		slog.InfoContext(ctx, "identity numbers purged", "count", n)
	}
	return nil
}
