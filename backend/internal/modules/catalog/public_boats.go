package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

type BoatCard struct {
	ID            uuid.UUID    `json:"id"`
	Code          string       `json:"code"`
	Name          string       `json:"name"`
	Slug          string       `json:"slug"`
	Summary       string       `json:"summary"`
	CategoryID    uuid.UUID    `json:"category_id"`
	ClassID       uuid.UUID    `json:"class_id"`
	MaxPassengers int32        `json:"max_passengers"`
	LengthCm      *int32       `json:"length_cm"`
	Cabins        int32        `json:"cabins"`
	FromPrice     int64        `json:"from_price"`
	FromUnit      string       `json:"from_unit"`
	Rating        float64      `json:"rating"`
	ReviewCount   int64        `json:"review_count"`
	Thumbnail     *media.Image `json:"thumbnail"`
}

type BoatFilter struct {
	RegionID, CategoryID, ClassID, RouteID *uuid.UUID
	MinPax                                 int32
	IDs                                    []uuid.UUID
}

func BoatCards(ctx context.Context, q *dbq.Queries, store storage.Store, loc string, f BoatFilter, limit, offset int32) ([]BoatCard, int64, error) {
	rows, err := q.ListBoatsPublic(ctx, dbq.ListBoatsPublicParams{Limit: limit, Offset: offset, Locale: loc, RegionID: f.RegionID,
		CategoryID: f.CategoryID, ClassID: f.ClassID, RouteID: f.RouteID, MinPax: f.MinPax, Ids: f.IDs})
	if err != nil {
		return nil, 0, err
	}
	total, err := q.CountBoatsPublic(ctx, dbq.CountBoatsPublicParams{RegionID: f.RegionID, CategoryID: f.CategoryID, ClassID: f.ClassID, RouteID: f.RouteID, MinPax: f.MinPax, Ids: f.IDs})
	if err != nil {
		return nil, 0, err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, b := range rows {
		ids = append(ids, b.ID)
	}
	gal, err := media.LoadGallery(ctx, q, store, EntityBoat, ids, loc, false)
	if err != nil {
		return nil, 0, err
	}
	out := make([]BoatCard, 0, len(rows))
	for _, b := range rows {
		out = append(out, BoatCard{ID: b.ID, Code: b.Code, Name: b.Name, Slug: b.Slug, Summary: b.Summary, CategoryID: b.CategoryID, ClassID: b.ClassID,
			MaxPassengers: b.MaxPassengers, LengthCm: b.LengthCm, Cabins: b.Cabins, FromPrice: b.FromPrice, FromUnit: b.FromUnit,
			Rating: b.Rating, ReviewCount: b.ReviewCount, Thumbnail: gal.First(b.ID, RoleThumbnail)})
	}
	return out, total, nil
}

func (h *BoatHandler) publicList(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	loc := i18n.Normalize(qs.Get("locale"))
	page := httpx.ParsePage(r, 12, 48)
	pax, _ := strconv.Atoi(qs.Get("pax"))
	f := BoatFilter{RegionID: IDs(strPtr(qs.Get("region_id"))), CategoryID: IDs(strPtr(qs.Get("category_id"))),
		ClassID: IDs(strPtr(qs.Get("class_id"))), RouteID: IDs(strPtr(qs.Get("route_id"))), MinPax: int32(max(pax, 0))}
	cards, total, err := BoatCards(r.Context(), dbq.New(h.pool), h.store, loc, f, int32(page.PerPage), int32(page.Offset()))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, cards, page)
}

type rateDTO struct {
	RateUnit string `json:"rate_unit"`
	Price    int64  `json:"price"`
	MinUnits int32  `json:"min_units"`
	MaxUnits int32  `json:"max_units"`
}

type boatRouteDTO struct {
	RouteCard
	FixedPrice         *int64 `json:"fixed_price"`
	MinDurationMinutes *int32 `json:"min_duration_minutes"`
}

type publicArea struct {
	ID          uuid.UUID     `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	DeckLabel   string        `json:"deck_label"`
	MinPax      int32         `json:"min_pax"`
	MaxPax      int32         `json:"max_pax"`
	BasePrice   int64         `json:"base_price"`
	Facilities  []publicNamed `json:"facilities"`
	Gallery     []media.Image `json:"gallery"`
}

type PolicySummary struct {
	PaymentType      string             `json:"payment_type"`
	DepositType      *string            `json:"deposit_type"`
	DepositValue     int64              `json:"deposit_value"`
	BalanceDueDays   int32              `json:"balance_due_days"`
	CancellationName string             `json:"cancellation_name"`
	CancellationText string             `json:"cancellation_text"`
	CancellationTier []CancellationTier `json:"cancellation_tiers"`
}

type boatDetail struct {
	BoatCard
	Description          string            `json:"description"`
	SEOTitle             string            `json:"seo_title"`
	SEODescription       string            `json:"seo_description"`
	Category             string            `json:"category"`
	Class                string            `json:"class"`
	BeamCm               *int32            `json:"beam_cm"`
	YearBuilt            *int32            `json:"year_built"`
	Bathrooms            int32             `json:"bathrooms"`
	SpeedKnots           *int32            `json:"speed_knots"`
	CrewCount            int32             `json:"crew_count"`
	OperatingStartMinute int32             `json:"operating_start_minute"`
	OperatingEndMinute   int32             `json:"operating_end_minute"`
	OvernightAllowed     bool              `json:"overnight_allowed"`
	TurnaroundMinutes    int32             `json:"turnaround_buffer_minutes"`
	HomePort             PortInfo          `json:"home_port"`
	Rates                []rateDTO         `json:"rates"`
	Routes               []boatRouteDTO    `json:"routes"`
	Regions              []RegionCard      `json:"regions"`
	Facilities           []publicNamed     `json:"facilities"`
	Areas                []publicArea      `json:"areas"`
	Gallery              []media.Image     `json:"gallery"`
	Policy               PolicySummary     `json:"policy"`
	Alternates           map[string]string `json:"alternates"`
}

func LoadPolicySummary(ctx context.Context, q *dbq.Queries, paymentPolicyID, cancellationPolicyID uuid.UUID, loc string) (PolicySummary, error) {
	pp, err := q.GetPaymentPolicy(ctx, paymentPolicyID)
	if err != nil {
		return PolicySummary{}, err
	}
	cp, err := q.GetCancellationPolicy(ctx, cancellationPolicyID)
	if err != nil {
		return PolicySummary{}, err
	}
	var tiers []CancellationTier
	_ = json.Unmarshal(cp.Tiers, &tiers)
	var desc map[string]string
	_ = json.Unmarshal(cp.Descriptions, &desc)
	return PolicySummary{PaymentType: pp.Type, DepositType: pp.DepositType, DepositValue: pp.DepositValue, BalanceDueDays: pp.BalanceDueDays,
		CancellationName: cp.Name, CancellationText: Pick(desc, loc), CancellationTier: tiers}, nil
}

func (h *BoatHandler) publicGet(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	id, err := ResolveSlug(ctx, q, EntityBoat, loc, chi.URLParam(r, "slug"), BoatSlugFinder(q), func(id uuid.UUID) (string, error) {
		t, err := q.GetBoatTranslation(ctx, dbq.GetBoatTranslationParams{BoatID: id, Locale: loc})
		return t.Slug, err
	})
	if err != nil {
		WriteResolveError(w, r, err)
		return
	}
	b, err := q.GetBoatAdmin(ctx, id)
	if err != nil {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	if b.Status == "ARCHIVED" {
		httpx.WriteError(w, r, httpx.NewError(http.StatusGone, "BOAT_ARCHIVED", "boat is no longer available"))
		return
	}
	if b.Status != "PUBLISHED" {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	cards, _, err := BoatCards(ctx, q, h.store, loc, BoatFilter{IDs: []uuid.UUID{id}}, 1, 0)
	if err != nil || len(cards) == 0 {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	var trs map[string]Translation
	_ = json.Unmarshal(b.Translations, &trs)
	t := Pick(trs, loc)
	d := boatDetail{BoatCard: cards[0], Description: t.Description, SEOTitle: t.SEOTitle, SEODescription: t.SEODescription,
		BeamCm: b.BeamCm, YearBuilt: b.YearBuilt, Bathrooms: b.Bathrooms, SpeedKnots: b.SpeedKnots, CrewCount: b.CrewCount,
		OperatingStartMinute: b.OperatingStartMinute, OperatingEndMinute: b.OperatingEndMinute, OvernightAllowed: b.OvernightAllowed,
		TurnaroundMinutes: b.TurnaroundBufferMinutes, Rates: []rateDTO{}, Routes: []boatRouteDTO{}, Regions: []RegionCard{},
		Facilities: []publicNamed{}, Areas: []publicArea{}, Alternates: map[string]string{}}
	for l, tr := range trs {
		d.Alternates[l] = tr.Slug
	}

	cats, err := q.ListCategories(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, c := range cats {
		if c.ID == b.CategoryID {
			d.Category = localized(c.Translations, loc).Name
		}
	}
	classes, err := q.ListClasses(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, c := range classes {
		if c.ID == b.ClassID {
			d.Class = localized(c.Translations, loc).Name
		}
	}
	ports, err := LoadPorts(ctx, q, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d.HomePort = ports[b.HomePortID]

	ids := []uuid.UUID{id}
	rates, err := q.ListBoatRates(ctx, ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, rt := range rates {
		d.Rates = append(d.Rates, rateDTO{RateUnit: rt.RateUnit, Price: rt.Price, MinUnits: rt.MinUnits, MaxUnits: rt.MaxUnits})
	}

	boatRoutes, err := q.ListBoatRoutes(ctx, ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	routeRows, err := q.ListRoutesPublic(ctx, dbq.ListRoutesPublicParams{Locale: loc})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	routeByID := map[uuid.UUID]dbq.ListRoutesPublicRow{}
	for _, rr := range routeRows {
		routeByID[rr.ID] = rr
	}
	for _, br := range boatRoutes {
		rr, ok := routeByID[br.RouteID]
		if !ok {
			continue
		}
		d.Routes = append(d.Routes, boatRouteDTO{RouteCard: RouteCard{ID: rr.ID, RegionID: rr.RegionID, Name: rr.Name, Slug: rr.Slug, Description: rr.Description, DurationMinutes: rr.DurationMinutes},
			FixedPrice: br.FixedPrice, MinDurationMinutes: br.MinDurationMinutes})
	}

	boatRegions, err := q.ListBoatRegions(ctx, ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	allRegions, err := RegionCards(ctx, q, h.store, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, br := range boatRegions {
		for _, rc := range allRegions {
			if rc.ID == br.RegionID {
				d.Regions = append(d.Regions, rc)
			}
		}
	}

	facRows, err := q.ListFacilities(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	facByID := map[uuid.UUID]publicNamed{}
	for _, f := range facRows {
		facByID[f.ID] = publicNamed{ID: f.ID, Name: localized(f.Translations, loc).Name, Icon: f.Icon}
	}
	boatFac, err := q.ListBoatFacilities(ctx, ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, bf := range boatFac {
		if f, ok := facByID[bf.FacilityID]; ok {
			d.Facilities = append(d.Facilities, f)
		}
	}

	areas, err := q.ListAreas(ctx, ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	areaIDs := []uuid.UUID{}
	for _, a := range areas {
		areaIDs = append(areaIDs, a.ID)
	}
	areaGal, err := media.LoadGallery(ctx, q, h.store, EntityArea, areaIDs, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, a := range areas {
		if a.IsSystem || a.Status != "ACTIVE" {
			continue
		}
		var at map[string]AreaTranslation
		_ = json.Unmarshal(a.Translations, &at)
		tr := Pick(at, loc)
		pa := publicArea{ID: a.ID, Name: tr.Name, Description: tr.Description, DeckLabel: a.DeckLabel, MinPax: a.MinPax, MaxPax: a.MaxPax,
			BasePrice: a.BasePrice, Facilities: []publicNamed{}, Gallery: areaGal.All(a.ID, RoleGallery)}
		for _, fid := range a.FacilityIds {
			if f, ok := facByID[fid]; ok {
				pa.Facilities = append(pa.Facilities, f)
			}
		}
		d.Areas = append(d.Areas, pa)
	}

	gal, err := media.LoadGallery(ctx, q, h.store, EntityBoat, ids, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d.Gallery = gal.All(id, RoleGallery)
	d.Policy, err = LoadPolicySummary(ctx, q, b.PaymentPolicyID, b.CancellationPolicyID, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}
