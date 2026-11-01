package departures

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
)

func itoa(i int) string { return strconv.Itoa(i) }

func strp(s string) *string { return &s }

type calendarEvent struct {
	BoatID      uuid.UUID  `json:"boat_id"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	StartsAt    time.Time  `json:"starts_at"`
	EndsAt      time.Time  `json:"ends_at"`
	BookingID   *uuid.UUID `json:"booking_id,omitempty"`
	DepartureID *uuid.UUID `json:"departure_id,omitempty"`
	BlockID     *uuid.UUID `json:"block_id,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	Partial     bool       `json:"partial"`
}

type calendarBoat struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

// calendar returns reservations for every boat (or one) collapsed to one event per source, so
// the admin sees charters, departures, holds and blocks on a single timeline.
func (h *Handler) calendar(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r)
	if from == nil || to == nil || !to.After(*from) || to.Sub(*from) > 93*24*time.Hour {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"from": "INVALID_RANGE"}))
		return
	}
	q := dbq.New(h.pool)
	boats, err := q.ListBoatsBasic(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := []uuid.UUID{}
	outBoats := []calendarBoat{}
	filter := catalog.IDs(strp(r.URL.Query().Get("boat_id")))
	areaCount := map[uuid.UUID]int{}
	for _, b := range boats {
		if filter != nil && *filter != b.ID {
			continue
		}
		ids = append(ids, b.ID)
		outBoats = append(outBoats, calendarBoat{ID: b.ID, Code: b.Code, Name: b.Name})
		areas, err := q.ListBoatAreaIDs(r.Context(), b.ID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		areaCount[b.ID] = len(areas)
	}
	rows, err := q.ListBoatReservations(r.Context(), dbq.ListBoatReservationsParams{BoatIds: ids, FromTime: *from, ToTime: *to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	type key struct {
		src uuid.UUID
	}
	agg := map[key]*calendarEvent{}
	counts := map[key]int{}
	order := []key{}
	boatOfArea := map[uuid.UUID]uuid.UUID{}
	for _, x := range rows {
		var src uuid.UUID
		ev := calendarEvent{Kind: x.Kind, Status: x.Status, StartsAt: x.StartsAt, EndsAt: x.EndsAt, ExpiresAt: x.ExpiresAt}
		switch {
		case x.BookingID != nil:
			src, ev.BookingID = *x.BookingID, x.BookingPublicID
		case x.DepartureID != nil:
			src, ev.DepartureID = *x.DepartureID, x.DepartureID
		case x.BlockID != nil:
			src, ev.BlockID = *x.BlockID, x.BlockID
		}
		k := key{src}
		if _, ok := agg[k]; !ok {
			if b, err := boatForArea(r, q, x.AreaID, boatOfArea); err == nil {
				ev.BoatID = b
			}
			agg[k] = &ev
			order = append(order, k)
		}
		counts[k]++
	}
	events := make([]calendarEvent, 0, len(order))
	for _, k := range order {
		ev := agg[k]
		ev.Partial = ev.Kind == "BLOCK" && counts[k] < areaCount[ev.BoatID]
		events = append(events, *ev)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"boats": outBoats, "events": events})
}

func boatForArea(r *http.Request, q *dbq.Queries, areaID uuid.UUID, cache map[uuid.UUID]uuid.UUID) (uuid.UUID, error) {
	if b, ok := cache[areaID]; ok {
		return b, nil
	}
	a, err := q.GetArea(r.Context(), areaID)
	if err != nil {
		return uuid.Nil, err
	}
	cache[areaID] = a.BoatID
	return a.BoatID, nil
}

type blockInput struct {
	AreaID   *uuid.UUID `json:"area_id"`
	Kind     string     `json:"kind"`
	StartsAt time.Time  `json:"starts_at"`
	EndsAt   time.Time  `json:"ends_at"`
	Reason   string     `json:"reason"`
}

// createBlock records maintenance or a manual block as BLOCK reservations, so it conflicts with
// charters and departures through the same exclusion constraint.
func (h *Handler) createBlock(w http.ResponseWriter, r *http.Request) {
	boatID, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in blockInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if (in.Kind != "MAINTENANCE" && in.Kind != "MANUAL") || !in.EndsAt.After(in.StartsAt) || len(in.Reason) > 500 {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"ends_at": "INVALID_RANGE"}))
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	var block dbq.BoatBlock
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.LockBoat(r.Context(), boatID); err != nil {
			return catalog.ErrNotFound
		}
		areas, err := q.ListBoatAreaIDs(r.Context(), boatID)
		if err != nil {
			return err
		}
		if in.AreaID != nil {
			found := false
			for _, a := range areas {
				if a == *in.AreaID {
					found = true
				}
			}
			if !found {
				return httpx.Validation(map[string]string{"area_id": "INVALID_AREA"})
			}
			areas = []uuid.UUID{*in.AreaID}
		}
		block, err = q.InsertBoatBlock(r.Context(), dbq.InsertBoatBlockParams{BoatID: boatID, AreaID: in.AreaID, Kind: in.Kind, StartsAt: in.StartsAt, EndsAt: in.EndsAt, Reason: in.Reason, CreatedBy: actor})
		if err != nil {
			return err
		}
		stale, err := q.ListExpiredHeldOverlapping(r.Context(), dbq.ListExpiredHeldOverlappingParams{BoatID: boatID, StartsAt: in.StartsAt, EndsAt: in.EndsAt})
		if err != nil {
			return err
		}
		for _, id := range stale {
			if id != nil {
				if _, err := expireStale(r, q, *id); err != nil {
					return err
				}
			}
		}
		sp, err := tx.Begin(r.Context())
		if err != nil {
			return err
		}
		bid := block.ID
		for _, a := range areas {
			if err := dbq.New(sp).InsertAreaReservation(r.Context(), dbq.InsertAreaReservationParams{AreaID: a, BoatID: boatID, StartsAt: in.StartsAt, EndsAt: in.EndsAt, Kind: "BLOCK", BlockID: &bid, Status: "ACTIVE"}); err != nil {
				_ = sp.Rollback(r.Context())
				if db.IsExclusionViolation(err) {
					return httpx.Conflict("BLOCK_CONFLICT", "the boat already has reservations in this period")
				}
				return err
			}
		}
		if err := sp.Commit(r.Context()); err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: "boat.blocked", EntityType: "boat_block", EntityID: block.ID.String(), After: in})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]uuid.UUID{"id": block.ID})
}

func (h *Handler) deleteBlock(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.DeleteBoatBlock(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return catalog.ErrNotFound
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: "boat.unblocked", EntityType: "boat_block", EntityID: id.String()})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func expireStale(r *http.Request, q *dbq.Queries, id uuid.UUID) (bool, error) {
	return bookings.ExpireIfStale(r.Context(), q, id, time.Now())
}
