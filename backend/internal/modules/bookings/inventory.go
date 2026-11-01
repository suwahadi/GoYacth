package bookings

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
)

// ExpireIfStale moves a PENDING_PAYMENT booking whose hold has passed to EXPIRED and releases
// everything it held. It locks the booking row first and is a no-op for any other state, so it is
// safe to call repeatedly and from concurrent transactions.
func ExpireIfStale(ctx context.Context, q *dbq.Queries, bookingID uuid.UUID, now time.Time) (bool, error) {
	b, err := q.LockBooking(ctx, bookingID)
	if err != nil {
		if db.IsNoRows(err) {
			return false, nil
		}
		return false, err
	}
	if Status(b.Status) != StatusPendingPayment || b.HoldExpiresAt == nil || b.HoldExpiresAt.After(now) {
		return false, nil
	}
	if _, err := q.SetBookingStatus(ctx, dbq.SetBookingStatusParams{ID: b.ID, Status: string(StatusExpired)}); err != nil {
		return false, err
	}
	return true, ReleaseHolds(ctx, q, b.ID)
}

// ReleaseHolds frees inventory and promo quota held by a booking that will never be paid.
func ReleaseHolds(ctx context.Context, q *dbq.Queries, bookingID uuid.UUID) error {
	if err := q.DeleteBookingReservations(ctx, &bookingID); err != nil {
		return err
	}
	promos, err := q.ReleasePromotionRedemptions(ctx, bookingID)
	if err != nil {
		return err
	}
	for _, p := range promos {
		if err := q.ReleasePromotionQuota(ctx, p); err != nil {
			return err
		}
	}
	return nil
}

// reserveCharter locks every area of the boat for the widened period. Expired holds that
// overlap are released first in this same transaction, so correctness never depends on the
// cleanup job. Any remaining overlap is rejected by the exclusion constraint.
func reserveCharter(ctx context.Context, tx pgx.Tx, q *dbq.Queries, bookingID uuid.UUID, r *resolved, holdUntil time.Time, now time.Time) error {
	stale, err := q.ListExpiredHeldOverlapping(ctx, dbq.ListExpiredHeldOverlappingParams{BoatID: r.Boat.ID, StartsAt: r.ReserveFrom, EndsAt: r.ReserveTo})
	if err != nil {
		return err
	}
	for _, id := range stale {
		if id == nil {
			continue
		}
		if _, err := ExpireIfStale(ctx, q, *id, now); err != nil {
			return err
		}
	}
	areas, err := q.ListBoatAreaIDs(ctx, r.Boat.ID)
	if err != nil {
		return err
	}
	if len(areas) == 0 {
		return ErrProductNotFound
	}
	sp, err := tx.Begin(ctx)
	if err != nil {
		return err
	}
	spq := dbq.New(sp)
	for _, areaID := range areas {
		err := spq.InsertAreaReservation(ctx, dbq.InsertAreaReservationParams{
			AreaID: areaID, BoatID: r.Boat.ID, StartsAt: r.ReserveFrom, EndsAt: r.ReserveTo,
			Kind: "CHARTER", BookingID: &bookingID, Status: "HELD", ExpiresAt: &holdUntil,
		})
		if err != nil {
			_ = sp.Rollback(ctx)
			if db.IsExclusionViolation(err) {
				return ErrSlotTaken
			}
			return err
		}
	}
	return sp.Commit(ctx)
}

// reserveDeparture serialises bookings for one departure on its row lock, then checks the slot
// and the boat's legal capacity. Private areas are additionally protected by a partial unique
// index so two bookings can never own the same slot even if this check were bypassed.
func reserveDeparture(ctx context.Context, q *dbq.Queries, r *resolved, pax int, now time.Time) error {
	if _, err := q.LockDeparture(ctx, *r.DepartureID); err != nil {
		return err
	}
	stale, err := q.ListExpiredPendingOnDeparture(ctx, r.DepartureID)
	if err != nil {
		return err
	}
	for _, id := range stale {
		if _, err := ExpireIfStale(ctx, q, id, now); err != nil {
			return err
		}
	}
	total, err := q.SumDeparturePax(ctx, r.DepartureID)
	if err != nil {
		return err
	}
	if total+int64(pax) > int64(r.Boat.MaxPassengers) {
		return ErrCapacityExceeded
	}
	if r.Slot.SlotType == SlotSeatPool {
		used, err := q.SumSlotPax(ctx, &r.Slot.ID)
		if err != nil {
			return err
		}
		if r.Slot.SeatCapacity == nil || used+int64(pax) > int64(*r.Slot.SeatCapacity) {
			return ErrCapacityExceeded
		}
	}
	return nil
}
