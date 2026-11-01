package departures

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

var (
	ErrNotFound      = httpx.NotFound("DEPARTURE_NOT_FOUND")
	ErrScheduleClash = httpx.Conflict("DEPARTURE_SCHEDULE_CONFLICT", "the boat is already reserved for part of this time")
)

// Canceller cancels bookings of a departure with operator rules; provided by the refunds flow.
type Canceller func(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, cancelType, reason string, actor *uuid.UUID) error

type Handler struct {
	pool   *pgxpool.Pool
	cancel Canceller
	now    func() time.Time
}

func NewHandler(pool *pgxpool.Pool, cancel Canceller) *Handler {
	return &Handler{pool: pool, cancel: cancel, now: time.Now}
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/departures", h.adminList)
	r.Post("/departures", h.create)
	r.Get("/departures/{id}", h.adminGet)
	r.Patch("/departures/{id}", h.update)
	r.Post("/departures/{id}/cancel", h.cancelDeparture)
	r.Get("/calendar", h.calendar)
	r.Post("/boats/{id}/blocks", h.createBlock)
	r.Delete("/blocks/{id}", h.deleteBlock)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/departures", h.publicList)
}

type SlotInput struct {
	SlotType     string      `json:"slot_type"`
	AreaIDs      []uuid.UUID `json:"area_ids"`
	Price        int64       `json:"price"`
	SeatCapacity *int32      `json:"seat_capacity"`
	MinPax       int32       `json:"min_pax"`
	MaxPax       int32       `json:"max_pax"`
}

type CreateInput struct {
	BoatID           uuid.UUID   `json:"boat_id"`
	RouteID          uuid.UUID   `json:"route_id"`
	DepartsDate      string      `json:"departs_date"`
	DepartsTime      string      `json:"departs_time"`
	ReturnsDate      string      `json:"returns_date"`
	ReturnsTime      string      `json:"returns_time"`
	CloseHoursBefore int32       `json:"close_hours_before"`
	Slots            []SlotInput `json:"slots"`
}

func localTime(date, clock, tz string) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, err
	}
	return time.ParseInLocation("2006-01-02 15:04", date+" "+clock, loc)
}

// Create inserts the departure, its slots and an ACTIVE reservation for every area of the boat
// in one transaction. The exclusion constraint rejects it if anything else holds the boat.
func Create(ctx context.Context, tx pgx.Tx, in CreateInput, actor *uuid.UUID, now time.Time) (dbq.Departure, error) {
	q := dbq.New(tx)
	f := httpx.FieldErrors{}
	b, err := q.LockBoat(ctx, in.BoatID)
	if err != nil {
		return dbq.Departure{}, httpx.Validation(map[string]string{"boat_id": "NOT_FOUND"})
	}
	if b.Status == "ARCHIVED" {
		f.Add("boat_id", "ARCHIVED")
	}
	if _, err := q.GetBoatRoute(ctx, dbq.GetBoatRouteParams{BoatID: b.ID, RouteID: in.RouteID}); err != nil {
		f.Add("route_id", "ROUTE_NOT_SERVED")
	}
	rt, err := q.GetRouteAdmin(ctx, in.RouteID)
	if err != nil {
		return dbq.Departure{}, httpx.Validation(map[string]string{"route_id": "NOT_FOUND"})
	}
	port, err := q.GetPort(ctx, rt.DeparturePortID)
	if err != nil {
		return dbq.Departure{}, err
	}
	departs, err1 := localTime(in.DepartsDate, in.DepartsTime, port.Timezone)
	returns, err2 := localTime(in.ReturnsDate, in.ReturnsTime, port.Timezone)
	if err1 != nil {
		f.Add("departs_date", "INVALID_DATE")
	}
	if err2 != nil || !returns.After(departs) {
		f.Add("returns_date", "INVALID_DATE")
	}
	if err1 == nil && !departs.After(now) {
		f.Add("departs_date", "IN_PAST")
	}
	if in.CloseHoursBefore < 0 || in.CloseHoursBefore > 24*60 {
		f.Add("close_hours_before", "OUT_OF_RANGE")
	}
	if len(in.Slots) == 0 || len(in.Slots) > 30 {
		f.Add("slots", "REQUIRED")
	}
	areas, err := q.ListAreas(ctx, []uuid.UUID{b.ID})
	if err != nil {
		return dbq.Departure{}, err
	}
	areaByID := map[uuid.UUID]dbq.ListAreasRow{}
	for _, a := range areas {
		areaByID[a.ID] = a
	}
	used := map[uuid.UUID]bool{}
	for i, s := range in.Slots {
		p := "slots." + itoa(i) + "."
		if s.Price < 0 {
			f.Add(p+"price", "OUT_OF_RANGE")
		}
		if s.MinPax < 1 || s.MaxPax < s.MinPax {
			f.Add(p+"max_pax", "OUT_OF_RANGE")
		}
		var areaCap int32
		for _, aid := range s.AreaIDs {
			a, ok := areaByID[aid]
			if !ok || used[aid] {
				f.Add(p+"area_ids", "INVALID_AREA")
				continue
			}
			used[aid] = true
			areaCap += a.MaxPax
		}
		switch s.SlotType {
		case bookings.SlotPrivateArea:
			if len(s.AreaIDs) != 1 {
				f.Add(p+"area_ids", "EXACTLY_ONE_AREA")
			} else if s.MaxPax > areaCap {
				f.Add(p+"max_pax", "EXCEEDS_AREA")
			}
			in.Slots[i].SeatCapacity = nil
		case bookings.SlotSeatPool:
			if len(s.AreaIDs) == 0 {
				f.Add(p+"area_ids", "REQUIRED")
			}
			if s.SeatCapacity == nil || *s.SeatCapacity < 1 || *s.SeatCapacity > areaCap || *s.SeatCapacity > b.MaxPassengers {
				f.Add(p+"seat_capacity", "OUT_OF_RANGE")
			}
		default:
			f.Add(p+"slot_type", "INVALID")
		}
	}
	if err := f.Err(); err != nil {
		return dbq.Departure{}, err
	}
	closes := departs.Add(-time.Duration(in.CloseHoursBefore) * time.Hour)
	d, err := q.InsertDeparture(ctx, dbq.InsertDepartureParams{BoatID: b.ID, RouteID: in.RouteID, DepartsAt: departs, ReturnsAt: returns, BookingClosesAt: closes, CreatedBy: actor})
	if err != nil {
		return dbq.Departure{}, err
	}
	for i, s := range in.Slots {
		slot, err := q.InsertDepartureSlot(ctx, dbq.InsertDepartureSlotParams{DepartureID: d.ID, SlotType: s.SlotType, Price: s.Price, SeatCapacity: s.SeatCapacity, MinPax: s.MinPax, MaxPax: s.MaxPax, SortOrder: int32(i)})
		if err != nil {
			return dbq.Departure{}, err
		}
		for _, aid := range s.AreaIDs {
			if err := q.InsertDepartureSlotArea(ctx, dbq.InsertDepartureSlotAreaParams{DepartureID: d.ID, SlotID: slot.ID, AreaID: aid}); err != nil {
				return dbq.Departure{}, err
			}
		}
	}
	buffer := time.Duration(b.TurnaroundBufferMinutes) * time.Minute
	from, to := departs.Add(-buffer), returns.Add(buffer)
	stale, err := q.ListExpiredHeldOverlapping(ctx, dbq.ListExpiredHeldOverlappingParams{BoatID: b.ID, StartsAt: from, EndsAt: to})
	if err != nil {
		return dbq.Departure{}, err
	}
	for _, id := range stale {
		if id != nil {
			if _, err := bookings.ExpireIfStale(ctx, q, *id, now); err != nil {
				return dbq.Departure{}, err
			}
		}
	}
	sp, err := tx.Begin(ctx)
	if err != nil {
		return dbq.Departure{}, err
	}
	spq := dbq.New(sp)
	depID := d.ID
	for _, a := range areas {
		if err := spq.InsertAreaReservation(ctx, dbq.InsertAreaReservationParams{AreaID: a.ID, BoatID: b.ID, StartsAt: from, EndsAt: to, Kind: "DEPARTURE", DepartureID: &depID, Status: "ACTIVE"}); err != nil {
			_ = sp.Rollback(ctx)
			if db.IsExclusionViolation(err) {
				return dbq.Departure{}, ErrScheduleClash
			}
			return dbq.Departure{}, err
		}
	}
	if err := sp.Commit(ctx); err != nil {
		return dbq.Departure{}, err
	}
	return d, audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "departure.created", EntityType: "departure", EntityID: d.ID.String(), After: in})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in CreateInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	var d dbq.Departure
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		var err error
		d, err = Create(r.Context(), tx, in, actor, h.now())
		return err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := h.detail(r.Context(), dbq.New(h.pool), d.ID, i18n.Default)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, out)
}

type SlotDTO struct {
	ID           uuid.UUID   `json:"id"`
	SlotType     string      `json:"slot_type"`
	AreaIDs      []uuid.UUID `json:"area_ids"`
	AreaNames    []string    `json:"area_names"`
	Price        int64       `json:"price"`
	SeatCapacity *int32      `json:"seat_capacity"`
	MinPax       int32       `json:"min_pax"`
	MaxPax       int32       `json:"max_pax"`
	BookedPax    int64       `json:"booked_pax"`
	Remaining    int64       `json:"remaining"`
	Available    bool        `json:"available"`
}

type DepartureDTO struct {
	ID              uuid.UUID `json:"id"`
	BoatID          uuid.UUID `json:"boat_id"`
	BoatName        string    `json:"boat_name"`
	BoatSlug        string    `json:"boat_slug"`
	RouteID         uuid.UUID `json:"route_id"`
	RouteName       string    `json:"route_name"`
	PortName        string    `json:"port_name"`
	Timezone        string    `json:"timezone"`
	DepartsAt       time.Time `json:"departs_at"`
	ReturnsAt       time.Time `json:"returns_at"`
	BookingClosesAt time.Time `json:"booking_closes_at"`
	Status          string    `json:"status"`
	CancelReason    string    `json:"cancel_reason,omitempty"`
	BookedPax       int64     `json:"booked_pax"`
	Capacity        int32     `json:"capacity"`
	Slots           []SlotDTO `json:"slots"`
}

type names struct {
	boat      map[uuid.UUID]dbq.ListBoatsAdminRow
	routes    map[uuid.UUID]map[string]catalog.Translation
	routePort map[uuid.UUID]uuid.UUID
	ports     map[uuid.UUID]catalog.PortInfo
	areas     map[uuid.UUID]string
}

func loadNames(ctx context.Context, q *dbq.Queries, loc string, boatIDs []uuid.UUID) (*names, error) {
	n := &names{boat: map[uuid.UUID]dbq.ListBoatsAdminRow{}, routes: map[uuid.UUID]map[string]catalog.Translation{}, routePort: map[uuid.UUID]uuid.UUID{}, areas: map[uuid.UUID]string{}}
	boats, err := q.ListBoatsAdmin(ctx, dbq.ListBoatsAdminParams{Limit: 10000, Offset: 0})
	if err != nil {
		return nil, err
	}
	for _, b := range boats {
		n.boat[b.ID] = b
	}
	routes, err := q.ListRoutesAdmin(ctx)
	if err != nil {
		return nil, err
	}
	for _, rt := range routes {
		var m map[string]catalog.Translation
		_ = json.Unmarshal(rt.Translations, &m)
		n.routes[rt.ID] = m
		n.routePort[rt.ID] = rt.DeparturePortID
	}
	n.ports, err = catalog.LoadPorts(ctx, q, loc)
	if err != nil {
		return nil, err
	}
	areas, err := q.ListAreas(ctx, boatIDs)
	if err != nil {
		return nil, err
	}
	for _, a := range areas {
		var m map[string]catalog.AreaTranslation
		_ = json.Unmarshal(a.Translations, &m)
		n.areas[a.ID] = catalog.Pick(m, loc).Name
	}
	return n, nil
}

func (n *names) boatName(id uuid.UUID, loc string) (string, string) {
	var m map[string]catalog.Translation
	_ = json.Unmarshal(n.boat[id].Translations, &m)
	t := catalog.Pick(m, loc)
	return t.Name, t.Slug
}

func toDTO(d dbq.Departure, slots []dbq.ListDepartureSlotsRow, n *names, loc string, bookedPax int64) DepartureDTO {
	bn, bs := n.boatName(d.BoatID, loc)
	port := n.ports[n.routePort[d.RouteID]]
	capacity := n.boat[d.BoatID].MaxPassengers
	out := DepartureDTO{ID: d.ID, BoatID: d.BoatID, BoatName: bn, BoatSlug: bs, RouteID: d.RouteID, RouteName: catalog.Pick(n.routes[d.RouteID], loc).Name,
		PortName: port.Name, Timezone: port.Timezone, DepartsAt: d.DepartsAt, ReturnsAt: d.ReturnsAt, BookingClosesAt: d.BookingClosesAt,
		Status: d.Status, CancelReason: d.CancelReason, Capacity: capacity, Slots: []SlotDTO{}}
	var total int64
	for _, s := range slots {
		if s.DepartureID != d.ID {
			continue
		}
		total += s.BookedPax
	}
	if bookedPax > total {
		total = bookedPax
	}
	out.BookedPax = total
	boatLeft := int64(capacity) - total
	for _, s := range slots {
		if s.DepartureID != d.ID {
			continue
		}
		sd := SlotDTO{ID: s.ID, SlotType: s.SlotType, AreaIDs: s.AreaIds, AreaNames: []string{}, Price: s.Price, SeatCapacity: s.SeatCapacity,
			MinPax: s.MinPax, MaxPax: s.MaxPax, BookedPax: s.BookedPax}
		for _, a := range s.AreaIds {
			sd.AreaNames = append(sd.AreaNames, n.areas[a])
		}
		if s.SlotType == bookings.SlotSeatPool && s.SeatCapacity != nil {
			sd.Remaining = min(int64(*s.SeatCapacity)-s.BookedPax, boatLeft)
		} else {
			if s.BookingCount == 0 {
				sd.Remaining = min(int64(s.MaxPax), boatLeft)
			}
		}
		if sd.Remaining < 0 {
			sd.Remaining = 0
		}
		sd.Available = d.Status == "SCHEDULED" && sd.Remaining > 0
		out.Slots = append(out.Slots, sd)
	}
	return out
}

func (h *Handler) detail(ctx context.Context, q *dbq.Queries, id uuid.UUID, loc string) (DepartureDTO, error) {
	d, err := q.GetDeparture(ctx, id)
	if err != nil {
		return DepartureDTO{}, ErrNotFound
	}
	slots, err := q.ListDepartureSlots(ctx, []uuid.UUID{id})
	if err != nil {
		return DepartureDTO{}, err
	}
	n, err := loadNames(ctx, q, loc, []uuid.UUID{d.BoatID})
	if err != nil {
		return DepartureDTO{}, err
	}
	booked, err := q.SumDeparturePax(ctx, &id)
	if err != nil {
		return DepartureDTO{}, err
	}
	return toDTO(d, slots, n, loc, booked), nil
}

func parseRange(r *http.Request) (*time.Time, *time.Time) {
	var from, to *time.Time
	if t, err := time.Parse(time.RFC3339, r.URL.Query().Get("from")); err == nil {
		from = &t
	}
	if t, err := time.Parse(time.RFC3339, r.URL.Query().Get("to")); err == nil {
		to = &t
	}
	return from, to
}

func (h *Handler) adminList(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 50, 200)
	from, to := parseRange(r)
	boatID := catalog.IDs(strp(r.URL.Query().Get("boat_id")))
	q := dbq.New(h.pool)
	rows, err := q.ListDeparturesAdmin(r.Context(), dbq.ListDeparturesAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), BoatID: boatID, FromTime: from, ToTime: to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	h.writeList(w, r, q, i18n.Default, rows)
}

func (h *Handler) writeList(w http.ResponseWriter, r *http.Request, q *dbq.Queries, loc string, rows []dbq.ListDeparturesAdminRow) {
	ids := make([]uuid.UUID, 0, len(rows))
	boatIDs := []uuid.UUID{}
	for _, d := range rows {
		ids = append(ids, d.ID)
		boatIDs = append(boatIDs, d.BoatID)
	}
	slots, err := q.ListDepartureSlots(r.Context(), ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	n, err := loadNames(r.Context(), q, loc, boatIDs)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]DepartureDTO, 0, len(rows))
	for _, d := range rows {
		out = append(out, toDTO(dbq.Departure{ID: d.ID, BoatID: d.BoatID, RouteID: d.RouteID, DepartsAt: d.DepartsAt, ReturnsAt: d.ReturnsAt,
			BookingClosesAt: d.BookingClosesAt, Status: d.Status, CancelReason: d.CancelReason}, slots, n, loc, d.BookedPax))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) publicList(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	loc := i18n.Normalize(qs.Get("locale"))
	from, to := parseRange(r)
	q := dbq.New(h.pool)
	rows, err := q.ListDeparturesPublic(r.Context(), dbq.ListDeparturesPublicParams{Limit: 100, BoatID: catalog.IDs(strp(qs.Get("boat_id"))),
		RouteID: catalog.IDs(strp(qs.Get("route_id"))), DepartureID: catalog.IDs(strp(qs.Get("departure_id"))), FromTime: from, ToTime: to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	conv := make([]dbq.ListDeparturesAdminRow, 0, len(rows))
	for _, d := range rows {
		conv = append(conv, dbq.ListDeparturesAdminRow{ID: d.ID, BoatID: d.BoatID, RouteID: d.RouteID, DepartsAt: d.DepartsAt, ReturnsAt: d.ReturnsAt,
			BookingClosesAt: d.BookingClosesAt, Status: d.Status})
	}
	w.Header().Set("Cache-Control", "no-store")
	h.writeList(w, r, q, loc, conv)
}

func (h *Handler) adminGet(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := h.detail(r.Context(), dbq.New(h.pool), id, i18n.Default)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type updateInput struct {
	CloseHoursBefore *int32 `json:"close_hours_before"`
	Slots            []struct {
		ID     uuid.UUID `json:"id"`
		Price  int64     `json:"price"`
		MaxPax int32     `json:"max_pax"`
	} `json:"slots"`
}

// update changes prices and booking close time only. Existing bookings keep their snapshot.
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in updateInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		d, err := q.LockDeparture(r.Context(), id)
		if err != nil {
			return ErrNotFound
		}
		if in.CloseHoursBefore != nil {
			if *in.CloseHoursBefore < 0 {
				return httpx.Validation(map[string]string{"close_hours_before": "OUT_OF_RANGE"})
			}
			if _, err := q.UpdateDepartureClose(r.Context(), dbq.UpdateDepartureCloseParams{ID: id, BookingClosesAt: d.DepartsAt.Add(-time.Duration(*in.CloseHoursBefore) * time.Hour)}); err != nil {
				return err
			}
		}
		for _, s := range in.Slots {
			slot, err := q.GetDepartureSlot(r.Context(), s.ID)
			if err != nil || slot.DepartureID != id || s.Price < 0 || s.MaxPax < slot.MinPax {
				return httpx.Validation(map[string]string{"slots": "INVALID"})
			}
			if err := q.UpdateDepartureSlotPrice(r.Context(), dbq.UpdateDepartureSlotPriceParams{ID: s.ID, Price: s.Price, MaxPax: s.MaxPax}); err != nil {
				return err
			}
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: "departure.updated", EntityType: "departure", EntityID: id.String(), After: in})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type cancelInput struct {
	Reason string `json:"reason"`
}

// cancelDeparture cancels the schedule and every booking in it with full refunds (PRD 5.2.6).
func (h *Handler) cancelDeparture(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in cancelInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if len(in.Reason) < 3 || len(in.Reason) > 500 {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"reason": "INVALID_LENGTH"}))
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		return CancelDeparture(r.Context(), tx, h.cancel, id, in.Reason, actor)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func CancelDeparture(ctx context.Context, tx pgx.Tx, cancel Canceller, id uuid.UUID, reason string, actor *uuid.UUID) error {
	q := dbq.New(tx)
	if _, err := q.LockDeparture(ctx, id); err != nil {
		return ErrNotFound
	}
	if _, err := q.CancelDeparture(ctx, dbq.CancelDepartureParams{ID: id, CancelReason: reason}); err != nil {
		if db.IsNoRows(err) {
			return httpx.Conflict("DEPARTURE_NOT_SCHEDULED", "departure is already cancelled")
		}
		return err
	}
	rows, err := q.ListActiveDepartureBookings(ctx, &id)
	if err != nil {
		return err
	}
	for _, b := range rows {
		if err := cancel(ctx, tx, b.ID, bookings.CancelDepartureCancelled, reason, actor); err != nil {
			return err
		}
	}
	if err := q.DeleteDepartureReservations(ctx, &id); err != nil {
		return err
	}
	return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "departure.cancelled", EntityType: "departure", EntityID: id.String(), After: map[string]any{"reason": reason, "bookings": len(rows)}})
}
