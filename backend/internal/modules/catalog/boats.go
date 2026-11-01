package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

const (
	RateHourly = "HOURLY"
	RateDaily  = "DAILY"
	RateFixed  = "FIXED"
)

type BoatHandler struct {
	pool  *pgxpool.Pool
	media *media.Service
	store storage.Store
}

func NewBoatHandler(pool *pgxpool.Pool, m *media.Service, store storage.Store) *BoatHandler {
	return &BoatHandler{pool: pool, media: m, store: store}
}

func (h *BoatHandler) AdminRoutes(r chi.Router) {
	r.Get("/boats", h.adminList)
	r.Get("/boats/{id}", h.adminGet)
	r.Post("/boats", h.save)
	r.Put("/boats/{id}", h.save)
	r.Delete("/boats/{id}", h.delete)
	r.Post("/boats/{id}/areas", h.saveArea)
	r.Put("/boats/{id}/areas/{areaID}", h.saveArea)
	r.Delete("/boats/{id}/areas/{areaID}", h.deleteArea)
}

func (h *BoatHandler) PublicRoutes(r chi.Router) {
	r.Get("/boats", h.publicList)
	r.Get("/boats/{slug}", h.publicGet)
}

type RateInput struct {
	ID       *uuid.UUID `json:"id,omitempty"`
	RateUnit string     `json:"rate_unit"`
	Price    int64      `json:"price"`
	MinUnits int32      `json:"min_units"`
	MaxUnits int32      `json:"max_units"`
}

type BoatRouteInput struct {
	RouteID            uuid.UUID `json:"route_id"`
	FixedPrice         *int64    `json:"fixed_price"`
	MinDurationMinutes *int32    `json:"min_duration_minutes"`
}

type boatInput struct {
	Code                    string           `json:"code"`
	CategoryID              uuid.UUID        `json:"category_id"`
	ClassID                 uuid.UUID        `json:"class_id"`
	Ownership               string           `json:"ownership"`
	PartnerID               *uuid.UUID       `json:"partner_id"`
	CommissionType          *string          `json:"commission_type"`
	CommissionValue         int64            `json:"commission_value"`
	HomePortID              uuid.UUID        `json:"home_port_id"`
	MaxPassengers           int32            `json:"max_passengers"`
	LengthCm                *int32           `json:"length_cm"`
	BeamCm                  *int32           `json:"beam_cm"`
	YearBuilt               *int32           `json:"year_built"`
	Cabins                  int32            `json:"cabins"`
	Bathrooms               int32            `json:"bathrooms"`
	SpeedKnots              *int32           `json:"speed_knots"`
	CrewCount               int32            `json:"crew_count"`
	TurnaroundBufferMinutes int32            `json:"turnaround_buffer_minutes"`
	OperatingStartMinute    int32            `json:"operating_start_minute"`
	OperatingEndMinute      int32            `json:"operating_end_minute"`
	OvernightAllowed        bool             `json:"overnight_allowed"`
	PaymentPolicyID         uuid.UUID        `json:"payment_policy_id"`
	CancellationPolicyID    uuid.UUID        `json:"cancellation_policy_id"`
	SortOrder               int32            `json:"sort_order"`
	Status                  string           `json:"status"`
	Translations            Translations     `json:"translations"`
	Rates                   []RateInput      `json:"rates"`
	RegionIDs               []uuid.UUID      `json:"region_ids"`
	Routes                  []BoatRouteInput `json:"routes"`
	FacilityIDs             []uuid.UUID      `json:"facility_ids"`
	mediaInput
}

var codeRe = regexp.MustCompile(`^[A-Z0-9-]{2,20}$`)

func (in *boatInput) validate() error {
	f := httpx.FieldErrors{}
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if !codeRe.MatchString(in.Code) {
		f.Add("code", "INVALID_CODE")
	}
	in.Translations = in.Translations.Trimmed()
	in.Translations.Validate(f, "", true)
	switch in.Ownership {
	case "OWNED":
		in.PartnerID, in.CommissionType, in.CommissionValue = nil, nil, 0
	case "PARTNER":
		if in.PartnerID == nil {
			f.Add("partner_id", "REQUIRED")
		}
		if in.CommissionType == nil || (*in.CommissionType != "PERCENTAGE" && *in.CommissionType != "FIXED") {
			f.Add("commission_type", "REQUIRED")
		} else if *in.CommissionType == "PERCENTAGE" && (in.CommissionValue < 0 || in.CommissionValue > 10000) {
			f.Add("commission_value", "OUT_OF_RANGE")
		}
		if in.CommissionValue < 0 {
			f.Add("commission_value", "OUT_OF_RANGE")
		}
	default:
		f.Add("ownership", "INVALID")
	}
	if in.MaxPassengers < 1 || in.MaxPassengers > 1000 {
		f.Add("max_passengers", "OUT_OF_RANGE")
	}
	if in.TurnaroundBufferMinutes < 0 || in.TurnaroundBufferMinutes > 24*60 {
		f.Add("turnaround_buffer_minutes", "OUT_OF_RANGE")
	}
	if in.OperatingStartMinute < 0 || in.OperatingStartMinute > 1439 || in.OperatingEndMinute <= in.OperatingStartMinute || in.OperatingEndMinute > 1440 {
		f.Add("operating_end_minute", "INVALID_HOURS")
	}
	if !validStatus(in.Status) {
		f.Add("status", "INVALID")
	}
	seen := map[string]bool{}
	for i, rt := range in.Rates {
		p := "rates." + itoa(i) + "."
		if rt.RateUnit != RateHourly && rt.RateUnit != RateDaily && rt.RateUnit != RateFixed || seen[rt.RateUnit] {
			f.Add(p+"rate_unit", "INVALID")
		}
		seen[rt.RateUnit] = true
		if rt.Price < 0 || rt.Price > 10_000_000_000 {
			f.Add(p+"price", "OUT_OF_RANGE")
		}
		if rt.MinUnits < 1 || rt.MaxUnits < rt.MinUnits || rt.MaxUnits > 720 {
			f.Add(p+"max_units", "OUT_OF_RANGE")
		}
		if rt.RateUnit == RateDaily && rt.MaxUnits > 1 && !in.OvernightAllowed {
			f.Add(p+"max_units", "OVERNIGHT_NOT_ALLOWED")
		}
	}
	for i, br := range in.Routes {
		if br.FixedPrice != nil && *br.FixedPrice < 0 {
			f.Add("routes."+itoa(i)+".fixed_price", "OUT_OF_RANGE")
		}
	}
	if in.Status == "PUBLISHED" {
		if len(in.Rates) == 0 {
			f.Add("rates", "REQUIRED_TO_PUBLISH")
		}
		if len(in.Routes) == 0 {
			f.Add("routes", "REQUIRED_TO_PUBLISH")
		}
	}
	return f.Err()
}

type boatAdminDTO struct {
	ID                      uuid.UUID        `json:"id"`
	Code                    string           `json:"code"`
	CategoryID              uuid.UUID        `json:"category_id"`
	ClassID                 uuid.UUID        `json:"class_id"`
	Ownership               string           `json:"ownership"`
	PartnerID               *uuid.UUID       `json:"partner_id"`
	CommissionType          *string          `json:"commission_type"`
	CommissionValue         int64            `json:"commission_value"`
	HomePortID              uuid.UUID        `json:"home_port_id"`
	MaxPassengers           int32            `json:"max_passengers"`
	LengthCm                *int32           `json:"length_cm"`
	BeamCm                  *int32           `json:"beam_cm"`
	YearBuilt               *int32           `json:"year_built"`
	Cabins                  int32            `json:"cabins"`
	Bathrooms               int32            `json:"bathrooms"`
	SpeedKnots              *int32           `json:"speed_knots"`
	CrewCount               int32            `json:"crew_count"`
	TurnaroundBufferMinutes int32            `json:"turnaround_buffer_minutes"`
	OperatingStartMinute    int32            `json:"operating_start_minute"`
	OperatingEndMinute      int32            `json:"operating_end_minute"`
	OvernightAllowed        bool             `json:"overnight_allowed"`
	PaymentPolicyID         uuid.UUID        `json:"payment_policy_id"`
	CancellationPolicyID    uuid.UUID        `json:"cancellation_policy_id"`
	SortOrder               int32            `json:"sort_order"`
	Status                  string           `json:"status"`
	Translations            json.RawMessage  `json:"translations"`
	Rates                   []RateInput      `json:"rates"`
	RegionIDs               []uuid.UUID      `json:"region_ids"`
	Routes                  []BoatRouteInput `json:"routes"`
	FacilityIDs             []uuid.UUID      `json:"facility_ids"`
	Areas                   []areaAdminDTO   `json:"areas"`
	Thumbnail               *media.Image     `json:"thumbnail"`
	Gallery                 []media.Image    `json:"gallery"`
	UpdatedAt               time.Time        `json:"updated_at"`
}

func boatToAdmin(b dbq.Boat, translations json.RawMessage) boatAdminDTO {
	return boatAdminDTO{ID: b.ID, Code: b.Code, CategoryID: b.CategoryID, ClassID: b.ClassID, Ownership: b.Ownership, PartnerID: b.PartnerID,
		CommissionType: b.CommissionType, CommissionValue: b.CommissionValue, HomePortID: b.HomePortID, MaxPassengers: b.MaxPassengers,
		LengthCm: b.LengthCm, BeamCm: b.BeamCm, YearBuilt: b.YearBuilt, Cabins: b.Cabins, Bathrooms: b.Bathrooms, SpeedKnots: b.SpeedKnots,
		CrewCount: b.CrewCount, TurnaroundBufferMinutes: b.TurnaroundBufferMinutes, OperatingStartMinute: b.OperatingStartMinute,
		OperatingEndMinute: b.OperatingEndMinute, OvernightAllowed: b.OvernightAllowed, PaymentPolicyID: b.PaymentPolicyID,
		CancellationPolicyID: b.CancellationPolicyID, SortOrder: b.SortOrder, Status: b.Status, Translations: translations, UpdatedAt: b.UpdatedAt,
		Rates: []RateInput{}, RegionIDs: []uuid.UUID{}, Routes: []BoatRouteInput{}, FacilityIDs: []uuid.UUID{}, Areas: []areaAdminDTO{}, Gallery: []media.Image{}}
}

func (h *BoatHandler) adminList(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 25, 100)
	var status *string
	if s := r.URL.Query().Get("status"); s != "" {
		status = &s
	}
	q := dbq.New(h.pool)
	rows, err := q.ListBoatsAdmin(r.Context(), dbq.ListBoatsAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Status: status})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountBoatsAdmin(r.Context(), status)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, b := range rows {
		ids = append(ids, b.ID)
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityBoat, ids, i18n.Default, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]boatAdminDTO, 0, len(rows))
	for _, b := range rows {
		d := boatToAdmin(dbq.Boat{ID: b.ID, Code: b.Code, CategoryID: b.CategoryID, ClassID: b.ClassID, Ownership: b.Ownership, PartnerID: b.PartnerID,
			CommissionType: b.CommissionType, CommissionValue: b.CommissionValue, HomePortID: b.HomePortID, MaxPassengers: b.MaxPassengers,
			Status: b.Status, SortOrder: b.SortOrder, UpdatedAt: b.UpdatedAt, PaymentPolicyID: b.PaymentPolicyID, CancellationPolicyID: b.CancellationPolicyID}, b.Translations)
		d.Thumbnail = gal.First(b.ID, RoleThumbnail)
		out = append(out, d)
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

func (h *BoatHandler) adminGet(w http.ResponseWriter, r *http.Request) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d, err := h.loadAdmin(r.Context(), dbq.New(h.pool), id)
	if err != nil {
		httpx.WriteError(w, r, MapWriteError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *BoatHandler) loadAdmin(ctx context.Context, q *dbq.Queries, id uuid.UUID) (boatAdminDTO, error) {
	b, err := q.GetBoatAdmin(ctx, id)
	if err != nil {
		return boatAdminDTO{}, err
	}
	d := boatToAdmin(dbq.Boat{ID: b.ID, Code: b.Code, CategoryID: b.CategoryID, ClassID: b.ClassID, Ownership: b.Ownership, PartnerID: b.PartnerID,
		CommissionType: b.CommissionType, CommissionValue: b.CommissionValue, HomePortID: b.HomePortID, MaxPassengers: b.MaxPassengers,
		LengthCm: b.LengthCm, BeamCm: b.BeamCm, YearBuilt: b.YearBuilt, Cabins: b.Cabins, Bathrooms: b.Bathrooms, SpeedKnots: b.SpeedKnots,
		CrewCount: b.CrewCount, TurnaroundBufferMinutes: b.TurnaroundBufferMinutes, OperatingStartMinute: b.OperatingStartMinute,
		OperatingEndMinute: b.OperatingEndMinute, OvernightAllowed: b.OvernightAllowed, PaymentPolicyID: b.PaymentPolicyID,
		CancellationPolicyID: b.CancellationPolicyID, SortOrder: b.SortOrder, Status: b.Status, UpdatedAt: b.UpdatedAt}, b.Translations)
	ids := []uuid.UUID{id}
	rates, err := q.ListBoatRates(ctx, ids)
	if err != nil {
		return d, err
	}
	for _, rt := range rates {
		id := rt.ID
		d.Rates = append(d.Rates, RateInput{ID: &id, RateUnit: rt.RateUnit, Price: rt.Price, MinUnits: rt.MinUnits, MaxUnits: rt.MaxUnits})
	}
	regions, err := q.ListBoatRegions(ctx, ids)
	if err != nil {
		return d, err
	}
	for _, x := range regions {
		d.RegionIDs = append(d.RegionIDs, x.RegionID)
	}
	routes, err := q.ListBoatRoutes(ctx, ids)
	if err != nil {
		return d, err
	}
	for _, x := range routes {
		d.Routes = append(d.Routes, BoatRouteInput{RouteID: x.RouteID, FixedPrice: x.FixedPrice, MinDurationMinutes: x.MinDurationMinutes})
	}
	facilities, err := q.ListBoatFacilities(ctx, ids)
	if err != nil {
		return d, err
	}
	for _, x := range facilities {
		d.FacilityIDs = append(d.FacilityIDs, x.FacilityID)
	}
	areas, err := q.ListAreas(ctx, ids)
	if err != nil {
		return d, err
	}
	areaIDs := make([]uuid.UUID, 0, len(areas))
	for _, a := range areas {
		areaIDs = append(areaIDs, a.ID)
	}
	areaGal, err := media.LoadGallery(ctx, q, h.store, EntityArea, areaIDs, i18n.Default, true)
	if err != nil {
		return d, err
	}
	for _, a := range areas {
		d.Areas = append(d.Areas, areaAdminDTO{ID: a.ID, DeckLabel: a.DeckLabel, IsSystem: a.IsSystem, MinPax: a.MinPax, MaxPax: a.MaxPax,
			BasePrice: a.BasePrice, SortOrder: a.SortOrder, Status: a.Status, Translations: a.Translations, FacilityIDs: a.FacilityIds, Gallery: areaGal.All(a.ID, RoleGallery)})
	}
	gal, err := media.LoadGallery(ctx, q, h.store, EntityBoat, ids, i18n.Default, true)
	if err != nil {
		return d, err
	}
	d.Thumbnail = gal.First(id, RoleThumbnail)
	d.Gallery = gal.All(id, RoleGallery)
	return d, nil
}

func (h *BoatHandler) save(w http.ResponseWriter, r *http.Request) {
	var in boatInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := in.validate(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := withAuditTx(r, h.pool, "boat.saved", EntityBoat, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		ctx := r.Context()
		var b dbq.Boat
		var err error
		if idParam == "" {
			b, err = q.InsertBoat(ctx, dbq.InsertBoatParams{Code: in.Code, CategoryID: in.CategoryID, ClassID: in.ClassID, Ownership: in.Ownership,
				PartnerID: in.PartnerID, CommissionType: in.CommissionType, CommissionValue: in.CommissionValue, HomePortID: in.HomePortID,
				MaxPassengers: in.MaxPassengers, LengthCm: in.LengthCm, BeamCm: in.BeamCm, YearBuilt: in.YearBuilt, Cabins: in.Cabins,
				Bathrooms: in.Bathrooms, SpeedKnots: in.SpeedKnots, CrewCount: in.CrewCount, TurnaroundBufferMinutes: in.TurnaroundBufferMinutes,
				OperatingStartMinute: in.OperatingStartMinute, OperatingEndMinute: in.OperatingEndMinute, OvernightAllowed: in.OvernightAllowed,
				PaymentPolicyID: in.PaymentPolicyID, CancellationPolicyID: in.CancellationPolicyID, SortOrder: in.SortOrder, Status: in.Status})
			if err == nil {
				err = createSystemArea(ctx, q, b)
			}
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			if _, err := q.LockBoat(ctx, id); err != nil {
				return "", nil, err
			}
			b, err = q.UpdateBoat(ctx, dbq.UpdateBoatParams{ID: id, Code: in.Code, CategoryID: in.CategoryID, ClassID: in.ClassID, Ownership: in.Ownership,
				PartnerID: in.PartnerID, CommissionType: in.CommissionType, CommissionValue: in.CommissionValue, HomePortID: in.HomePortID,
				MaxPassengers: in.MaxPassengers, LengthCm: in.LengthCm, BeamCm: in.BeamCm, YearBuilt: in.YearBuilt, Cabins: in.Cabins,
				Bathrooms: in.Bathrooms, SpeedKnots: in.SpeedKnots, CrewCount: in.CrewCount, TurnaroundBufferMinutes: in.TurnaroundBufferMinutes,
				OperatingStartMinute: in.OperatingStartMinute, OperatingEndMinute: in.OperatingEndMinute, OvernightAllowed: in.OvernightAllowed,
				PaymentPolicyID: in.PaymentPolicyID, CancellationPolicyID: in.CancellationPolicyID, SortOrder: in.SortOrder, Status: in.Status})
			if err == nil {
				err = syncSystemArea(ctx, q, b)
			}
		}
		if db.UniqueConstraint(err) == "boats_code_key" {
			return "", nil, httpx.Validation(map[string]string{"code": "CODE_TAKEN"})
		}
		if err != nil {
			return "", nil, err
		}
		saved = b.ID
		err = saveTranslations(ctx, q, EntityBoat, b.ID, in.Translations, BoatSlugFinder(q),
			func(loc string) (string, error) {
				t, err := q.GetBoatTranslation(ctx, dbq.GetBoatTranslationParams{BoatID: b.ID, Locale: loc})
				return t.Slug, err
			},
			func(loc string, tr Translation, slug string) error {
				return q.UpsertBoatTranslation(ctx, dbq.UpsertBoatTranslationParams{BoatID: b.ID, Locale: loc, Name: tr.Name, Slug: slug,
					Summary: tr.Summary, Description: tr.Description, SeoTitle: tr.SEOTitle, SeoDescription: tr.SEODescription})
			})
		if err != nil {
			return "", nil, err
		}
		units := make([]string, 0, len(in.Rates))
		for _, rt := range in.Rates {
			units = append(units, rt.RateUnit)
			if err := q.UpsertBoatRate(ctx, dbq.UpsertBoatRateParams{BoatID: b.ID, RateUnit: rt.RateUnit, Price: rt.Price, MinUnits: rt.MinUnits, MaxUnits: rt.MaxUnits}); err != nil {
				return "", nil, err
			}
		}
		if err := q.DeleteBoatRatesExcept(ctx, dbq.DeleteBoatRatesExceptParams{BoatID: b.ID, Keep: units}); err != nil {
			return "", nil, err
		}
		if err := q.DeleteBoatRegions(ctx, b.ID); err != nil {
			return "", nil, err
		}
		for _, rid := range in.RegionIDs {
			if err := q.InsertBoatRegion(ctx, dbq.InsertBoatRegionParams{BoatID: b.ID, RegionID: rid}); err != nil {
				return "", nil, err
			}
		}
		if err := q.DeleteBoatRoutes(ctx, b.ID); err != nil {
			return "", nil, err
		}
		seenRoute := map[uuid.UUID]bool{}
		for _, br := range in.Routes {
			if seenRoute[br.RouteID] {
				continue
			}
			seenRoute[br.RouteID] = true
			if err := q.InsertBoatRoute(ctx, dbq.InsertBoatRouteParams{BoatID: b.ID, RouteID: br.RouteID, FixedPrice: br.FixedPrice, MinDurationMinutes: br.MinDurationMinutes}); err != nil {
				return "", nil, err
			}
		}
		if err := q.DeleteBoatFacilities(ctx, b.ID); err != nil {
			return "", nil, err
		}
		for _, fid := range in.FacilityIDs {
			if err := q.InsertBoatFacility(ctx, dbq.InsertBoatFacilityParams{BoatID: b.ID, FacilityID: fid}); err != nil {
				return "", nil, err
			}
		}
		if err := h.saveMediaFor(ctx, tx, EntityBoat, b.ID, in.mediaInput); err != nil {
			return "", nil, err
		}
		return b.ID.String(), map[string]any{"code": in.Code, "status": in.Status, "rates": in.Rates, "commission_type": in.CommissionType, "commission_value": in.CommissionValue}, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d, err := h.loadAdmin(r.Context(), dbq.New(h.pool), saved)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *BoatHandler) saveMediaFor(ctx context.Context, tx pgx.Tx, entity string, id uuid.UUID, in mediaInput) error {
	return (&LocationHandler{media: h.media}).saveMedia(ctx, tx, entity, id, in)
}

// Every boat keeps one system area so inventory always has at least one row to lock. It is only
// offered for sale while the boat has no separately sold areas.
func createSystemArea(ctx context.Context, q *dbq.Queries, b dbq.Boat) error {
	a, err := q.InsertArea(ctx, dbq.InsertAreaParams{BoatID: b.ID, DeckLabel: "", IsSystem: true, MinPax: 1, MaxPax: b.MaxPassengers, BasePrice: 0, SortOrder: 0, Status: "ACTIVE"})
	if err != nil {
		return err
	}
	for _, loc := range i18n.Supported {
		name := "Whole Boat"
		if loc == "id" {
			name = "Seluruh Kapal"
		}
		if err := q.UpsertAreaTranslation(ctx, dbq.UpsertAreaTranslationParams{AreaID: a.ID, Locale: loc, Name: name}); err != nil {
			return err
		}
	}
	return nil
}

func syncSystemArea(ctx context.Context, q *dbq.Queries, b dbq.Boat) error {
	areas, err := q.ListAreas(ctx, []uuid.UUID{b.ID})
	if err != nil {
		return err
	}
	userAreas := 0
	for _, a := range areas {
		if !a.IsSystem {
			userAreas++
		}
	}
	for _, a := range areas {
		if a.IsSystem {
			status := "ACTIVE"
			if userAreas > 0 {
				status = "INACTIVE"
			}
			_, err := q.UpdateArea(ctx, dbq.UpdateAreaParams{ID: a.ID, DeckLabel: a.DeckLabel, MinPax: 1, MaxPax: b.MaxPassengers, BasePrice: a.BasePrice, SortOrder: a.SortOrder, Status: status})
			return err
		}
	}
	return createSystemArea(ctx, q, b)
}

func (h *BoatHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = withAuditTx(r, h.pool, "boat.deleted", EntityBoat, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		ctx := r.Context()
		n, err := q.CountBoatBookings(ctx, id)
		if err != nil {
			return "", nil, err
		}
		if n > 0 {
			return "", nil, httpx.Conflict("BOAT_HAS_BOOKINGS", "boats with bookings or departures cannot be deleted; archive instead")
		}
		areas, err := q.ListAreas(ctx, []uuid.UUID{id})
		if err != nil {
			return "", nil, err
		}
		for _, a := range areas {
			if err := h.media.RemoveEntity(ctx, tx, EntityArea, a.ID); err != nil {
				return "", nil, err
			}
		}
		if err := h.media.RemoveEntity(ctx, tx, EntityBoat, id); err != nil {
			return "", nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM area_reservations WHERE boat_id = $1 AND kind = 'BLOCK'`, id); err != nil {
			return "", nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM boat_blocks WHERE boat_id = $1`, id); err != nil {
			return "", nil, err
		}
		if err := q.DeleteBoatAreas(ctx, id); err != nil {
			if db.IsForeignKeyViolation(err) {
				return "", nil, ErrInUse
			}
			return "", nil, err
		}
		n2, err := q.DeleteBoat(ctx, id)
		if db.IsForeignKeyViolation(err) {
			return "", nil, ErrInUse
		}
		if err == nil && n2 == 0 {
			return "", nil, ErrNotFound
		}
		return id.String(), nil, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type AreaTranslation struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type areaAdminDTO struct {
	ID           uuid.UUID       `json:"id"`
	DeckLabel    string          `json:"deck_label"`
	IsSystem     bool            `json:"is_system"`
	MinPax       int32           `json:"min_pax"`
	MaxPax       int32           `json:"max_pax"`
	BasePrice    int64           `json:"base_price"`
	SortOrder    int32           `json:"sort_order"`
	Status       string          `json:"status"`
	Translations json.RawMessage `json:"translations"`
	FacilityIDs  []uuid.UUID     `json:"facility_ids"`
	Gallery      []media.Image   `json:"gallery"`
}

type areaInput struct {
	DeckLabel    string                     `json:"deck_label"`
	MinPax       int32                      `json:"min_pax"`
	MaxPax       int32                      `json:"max_pax"`
	BasePrice    int64                      `json:"base_price"`
	SortOrder    int32                      `json:"sort_order"`
	Status       string                     `json:"status"`
	Translations map[string]AreaTranslation `json:"translations"`
	FacilityIDs  []uuid.UUID                `json:"facility_ids"`
	GalleryIDs   []uuid.UUID                `json:"gallery_ids"`
}

func (h *BoatHandler) saveArea(w http.ResponseWriter, r *http.Request) {
	boatID, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in areaInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if strings.TrimSpace(in.Translations[i18n.Default].Name) == "" {
		f.Add("translations."+i18n.Default+".name", "REQUIRED")
	}
	if in.MinPax < 1 || in.MaxPax < in.MinPax {
		f.Add("max_pax", "OUT_OF_RANGE")
	}
	if in.BasePrice < 0 {
		f.Add("base_price", "OUT_OF_RANGE")
	}
	if in.Status != "ACTIVE" && in.Status != "INACTIVE" {
		f.Add("status", "INVALID")
	}
	if len(in.DeckLabel) > 40 {
		f.Add("deck_label", "TOO_LONG")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	areaParam := chi.URLParam(r, "areaID")
	var saved uuid.UUID
	err = withAuditTx(r, h.pool, "area.saved", EntityArea, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		ctx := r.Context()
		b, err := q.LockBoat(ctx, boatID)
		if err != nil {
			return "", nil, err
		}
		if in.MaxPax > b.MaxPassengers {
			return "", nil, httpx.Validation(map[string]string{"max_pax": "EXCEEDS_BOAT_CAPACITY"})
		}
		var a dbq.Area
		if areaParam == "" {
			a, err = q.InsertArea(ctx, dbq.InsertAreaParams{BoatID: boatID, DeckLabel: in.DeckLabel, MinPax: in.MinPax, MaxPax: in.MaxPax, BasePrice: in.BasePrice, SortOrder: in.SortOrder, Status: in.Status})
			if err == nil {
				err = addAreaToFutureDepartures(ctx, tx, a)
			}
		} else {
			aid, perr := uuid.Parse(areaParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			existing, gerr := q.GetArea(ctx, aid)
			if gerr != nil || existing.BoatID != boatID || existing.IsSystem {
				return "", nil, ErrNotFound
			}
			a, err = q.UpdateArea(ctx, dbq.UpdateAreaParams{ID: aid, DeckLabel: in.DeckLabel, MinPax: in.MinPax, MaxPax: in.MaxPax, BasePrice: in.BasePrice, SortOrder: in.SortOrder, Status: in.Status})
		}
		if err != nil {
			return "", nil, err
		}
		saved = a.ID
		for loc, t := range in.Translations {
			if !i18n.Valid(loc) || strings.TrimSpace(t.Name) == "" {
				continue
			}
			if err := q.UpsertAreaTranslation(ctx, dbq.UpsertAreaTranslationParams{AreaID: a.ID, Locale: loc, Name: strings.TrimSpace(t.Name), Description: t.Description}); err != nil {
				return "", nil, err
			}
		}
		if err := q.DeleteAreaFacilities(ctx, a.ID); err != nil {
			return "", nil, err
		}
		for _, fid := range in.FacilityIDs {
			if err := q.InsertAreaFacility(ctx, dbq.InsertAreaFacilityParams{AreaID: a.ID, FacilityID: fid}); err != nil {
				return "", nil, err
			}
		}
		if err := h.media.SetUsages(ctx, tx, EntityArea, a.ID, RoleGallery, in.GalleryIDs); err != nil {
			return "", nil, err
		}
		if err := syncSystemArea(ctx, q, b); err != nil {
			return "", nil, err
		}
		return a.ID.String(), in, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

// addAreaToFutureDepartures keeps the invariant that every area of a boat is reserved for each
// scheduled departure; a new area must not become bookable by a charter during a departure.
func addAreaToFutureDepartures(ctx context.Context, tx pgx.Tx, a dbq.Area) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO area_reservations (area_id, boat_id, period, kind, departure_id, status)
		SELECT $1, d.boat_id, ar.period, 'DEPARTURE', d.id, 'ACTIVE'
		FROM departures d
		JOIN LATERAL (SELECT period FROM area_reservations x WHERE x.departure_id = d.id LIMIT 1) ar ON true
		WHERE d.boat_id = $2 AND d.status = 'SCHEDULED' AND d.returns_at > now()`, a.ID, a.BoatID)
	if db.IsExclusionViolation(err) {
		return httpx.Conflict("AREA_SCHEDULE_CONFLICT", "the boat has overlapping reservations")
	}
	return err
}

func (h *BoatHandler) deleteArea(w http.ResponseWriter, r *http.Request) {
	boatID, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	areaID, err := ParamID(r, "areaID")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = withAuditTx(r, h.pool, "area.deleted", EntityArea, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		ctx := r.Context()
		b, err := q.LockBoat(ctx, boatID)
		if err != nil {
			return "", nil, err
		}
		a, err := q.GetArea(ctx, areaID)
		if err != nil || a.BoatID != boatID || a.IsSystem {
			return "", nil, ErrNotFound
		}
		n, err := q.CountAreaReferences(ctx, areaID)
		if err != nil {
			return "", nil, err
		}
		if n > 0 {
			return "", nil, httpx.Conflict("AREA_IN_USE", "area has reservations; set it inactive instead")
		}
		if err := h.media.RemoveEntity(ctx, tx, EntityArea, areaID); err != nil {
			return "", nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM area_reservations WHERE area_id = $1 AND kind = 'BLOCK'`, areaID); err != nil {
			return "", nil, err
		}
		if _, err := q.DeleteArea(ctx, areaID); err != nil {
			if db.IsForeignKeyViolation(err) {
				return "", nil, ErrInUse
			}
			return "", nil, err
		}
		return areaID.String(), nil, syncSystemArea(ctx, q, b)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}
