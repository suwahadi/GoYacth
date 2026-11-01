package packages

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

const EntityPackage = "package"

type Handler struct {
	pool  *pgxpool.Pool
	media *media.Service
	store storage.Store
}

func NewHandler(pool *pgxpool.Pool, m *media.Service, store storage.Store) *Handler {
	return &Handler{pool: pool, media: m, store: store}
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/packages", h.adminList)
	r.Get("/packages/{id}", h.adminGet)
	r.Post("/packages", h.save)
	r.Put("/packages/{id}", h.save)
	r.Delete("/packages/{id}", h.delete)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/packages", h.publicList)
	r.Get("/packages/{slug}", h.publicGet)
}

type Translation struct {
	catalog.Translation
	Inclusions []string `json:"inclusions"`
	Exclusions []string `json:"exclusions"`
}

type OfferingInput struct {
	ID              *uuid.UUID `json:"id"`
	BoatID          uuid.UUID  `json:"boat_id"`
	DepartureSlotID *uuid.UUID `json:"departure_slot_id"`
	Price           int64      `json:"price"`
}

type input struct {
	Mode                 string                 `json:"mode"`
	RouteID              *uuid.UUID             `json:"route_id"`
	DurationMinutes      *int32                 `json:"duration_minutes"`
	DepartureID          *uuid.UUID             `json:"departure_id"`
	MinPax               int32                  `json:"min_pax"`
	MaxPax               int32                  `json:"max_pax"`
	ValidFrom            string                 `json:"valid_from"`
	ValidUntil           string                 `json:"valid_until"`
	BookingCutoffHours   int32                  `json:"booking_cutoff_hours"`
	PaymentPolicyID      uuid.UUID              `json:"payment_policy_id"`
	CancellationPolicyID uuid.UUID              `json:"cancellation_policy_id"`
	SortOrder            int32                  `json:"sort_order"`
	Status               string                 `json:"status"`
	Translations         map[string]Translation `json:"translations"`
	Offerings            []OfferingInput        `json:"offerings"`
	ThumbnailID          *uuid.UUID             `json:"thumbnail_id"`
	GalleryIDs           []uuid.UUID            `json:"gallery_ids"`
}

func (in *input) validate() (time.Time, time.Time, error) {
	f := httpx.FieldErrors{}
	trs := catalog.Translations{}
	for loc, t := range in.Translations {
		trs[loc] = t.Translation
		if len(t.Inclusions) > 30 || len(t.Exclusions) > 30 {
			f.Add("translations."+loc, "TOO_MANY_ITEMS")
		}
	}
	trs.Validate(f, "", true)
	from, err1 := time.Parse("2006-01-02", in.ValidFrom)
	until, err2 := time.Parse("2006-01-02", in.ValidUntil)
	if err1 != nil {
		f.Add("valid_from", "INVALID_DATE")
	}
	if err2 != nil || until.Before(from) {
		f.Add("valid_until", "INVALID_DATE")
	}
	if in.MinPax < 1 || in.MaxPax < in.MinPax {
		f.Add("max_pax", "OUT_OF_RANGE")
	}
	if in.BookingCutoffHours < 0 || in.BookingCutoffHours > 24*60 {
		f.Add("booking_cutoff_hours", "OUT_OF_RANGE")
	}
	if in.Status != "DRAFT" && in.Status != "PUBLISHED" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	switch in.Mode {
	case "PRIVATE_CHARTER":
		if in.RouteID == nil {
			f.Add("route_id", "REQUIRED")
		}
		if in.DurationMinutes == nil || *in.DurationMinutes < 30 || *in.DurationMinutes > 60*24*14 {
			f.Add("duration_minutes", "OUT_OF_RANGE")
		}
		in.DepartureID = nil
		for i := range in.Offerings {
			in.Offerings[i].DepartureSlotID = nil
		}
	case "DEPARTURE":
		if in.DepartureID == nil {
			f.Add("departure_id", "REQUIRED")
		}
		in.RouteID, in.DurationMinutes = nil, nil
		for i, o := range in.Offerings {
			if o.DepartureSlotID == nil {
				f.Add("offerings."+itoa(i)+".departure_slot_id", "REQUIRED")
			}
		}
	default:
		f.Add("mode", "INVALID")
	}
	if len(in.Offerings) > 50 {
		f.Add("offerings", "TOO_MANY")
	}
	if in.Status == "PUBLISHED" && len(in.Offerings) == 0 {
		f.Add("offerings", "REQUIRED_TO_PUBLISH")
	}
	for i, o := range in.Offerings {
		if o.Price < 0 {
			f.Add("offerings."+itoa(i)+".price", "OUT_OF_RANGE")
		}
	}
	return from, until, f.Err()
}

func finder(q *dbq.Queries) catalog.SlugFinder {
	return func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
		id, err := q.FindPackageBySlug(ctx, dbq.FindPackageBySlugParams{Locale: locale, Slug: slug})
		if db.IsNoRows(err) {
			return uuid.Nil, nil
		}
		return id, err
	}
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	var in input
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	from, until, err := in.validate()
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	var saved uuid.UUID
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		ctx := r.Context()
		q := dbq.New(tx)
		if in.Mode == "DEPARTURE" {
			dep, err := q.GetDeparture(ctx, *in.DepartureID)
			if err != nil {
				return httpx.Validation(map[string]string{"departure_id": "NOT_FOUND"})
			}
			for i, o := range in.Offerings {
				slot, err := q.GetDepartureSlot(ctx, *o.DepartureSlotID)
				if err != nil || slot.DepartureID != dep.ID || o.BoatID != dep.BoatID {
					return httpx.Validation(map[string]string{"offerings." + itoa(i): "SLOT_MISMATCH"})
				}
			}
		} else {
			for i, o := range in.Offerings {
				if _, err := q.GetBoatRoute(ctx, dbq.GetBoatRouteParams{BoatID: o.BoatID, RouteID: *in.RouteID}); err != nil {
					return httpx.Validation(map[string]string{"offerings." + itoa(i) + ".boat_id": "ROUTE_NOT_SERVED"})
				}
			}
		}
		var p dbq.Package
		var err error
		params := dbq.InsertPackageParams{Mode: in.Mode, RouteID: in.RouteID, DurationMinutes: in.DurationMinutes, DepartureID: in.DepartureID,
			MinPax: in.MinPax, MaxPax: in.MaxPax, ValidFrom: from, ValidUntil: until, BookingCutoffHours: in.BookingCutoffHours,
			PaymentPolicyID: in.PaymentPolicyID, CancellationPolicyID: in.CancellationPolicyID, SortOrder: in.SortOrder, Status: in.Status}
		if idParam == "" {
			p, err = q.InsertPackage(ctx, params)
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return catalog.ErrNotFound
			}
			p, err = q.UpdatePackage(ctx, dbq.UpdatePackageParams{ID: id, Mode: params.Mode, RouteID: params.RouteID, DurationMinutes: params.DurationMinutes,
				DepartureID: params.DepartureID, MinPax: params.MinPax, MaxPax: params.MaxPax, ValidFrom: from, ValidUntil: until,
				BookingCutoffHours: params.BookingCutoffHours, PaymentPolicyID: params.PaymentPolicyID, CancellationPolicyID: params.CancellationPolicyID,
				SortOrder: params.SortOrder, Status: params.Status})
		}
		if err != nil {
			return catalog.MapWriteError(err)
		}
		saved = p.ID
		for loc, t := range in.Translations {
			slug, err := catalog.UniqueSlug(ctx, finder(q), p.ID, loc, t.Slug, t.Name)
			if err != nil {
				return err
			}
			old, err := q.GetPackageTranslation(ctx, dbq.GetPackageTranslationParams{PackageID: p.ID, Locale: loc})
			if err != nil && !db.IsNoRows(err) {
				return err
			}
			inc, _ := json.Marshal(clean(t.Inclusions))
			exc, _ := json.Marshal(clean(t.Exclusions))
			if err := q.UpsertPackageTranslation(ctx, dbq.UpsertPackageTranslationParams{PackageID: p.ID, Locale: loc, Name: strings.TrimSpace(t.Name), Slug: slug,
				Summary: t.Summary, Description: t.Description, Inclusions: inc, Exclusions: exc, SeoTitle: t.SEOTitle, SeoDescription: t.SEODescription}); err != nil {
				return err
			}
			if err := catalog.RecordSlugChange(ctx, q, EntityPackage, loc, old.Slug, slug, p.ID); err != nil {
				return err
			}
		}
		keep := []uuid.UUID{}
		for _, o := range in.Offerings {
			if o.ID != nil {
				if err := q.UpdatePackageOffering(ctx, dbq.UpdatePackageOfferingParams{ID: *o.ID, BoatID: o.BoatID, DepartureSlotID: o.DepartureSlotID, Price: o.Price, PackageID: p.ID}); err != nil {
					return err
				}
				keep = append(keep, *o.ID)
			}
		}
		if err := q.DeletePackageOfferingsExcept(ctx, dbq.DeletePackageOfferingsExceptParams{PackageID: p.ID, Keep: keep}); err != nil {
			if db.IsForeignKeyViolation(err) {
				return httpx.Conflict("OFFERING_IN_USE", "an offering removed from the package is referenced elsewhere")
			}
			return err
		}
		for _, o := range in.Offerings {
			if o.ID == nil {
				if _, err := q.InsertPackageOffering(ctx, dbq.InsertPackageOfferingParams{PackageID: p.ID, BoatID: o.BoatID, DepartureSlotID: o.DepartureSlotID, Price: o.Price}); err != nil {
					if db.IsUniqueViolation(err) {
						return httpx.Validation(map[string]string{"offerings": "DUPLICATE"})
					}
					return catalog.MapWriteError(err)
				}
			}
		}
		var thumb []uuid.UUID
		if in.ThumbnailID != nil {
			thumb = []uuid.UUID{*in.ThumbnailID}
		}
		if err := h.media.SetUsages(ctx, tx, EntityPackage, p.ID, catalog.RoleThumbnail, thumb); err != nil {
			return err
		}
		if err := h.media.SetUsages(ctx, tx, EntityPackage, p.ID, catalog.RoleGallery, in.GalleryIDs); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "package.saved", EntityType: EntityPackage, EntityID: p.ID.String(), After: in})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func clean(items []string) []string {
	out := []string{}
	for _, s := range items {
		if s = strings.TrimSpace(s); s != "" && validate.Length(s, 1, 200) {
			out = append(out, s)
		}
	}
	return out
}

type offeringDTO struct {
	ID              uuid.UUID  `json:"id"`
	BoatID          uuid.UUID  `json:"boat_id"`
	BoatName        string     `json:"boat_name,omitempty"`
	BoatSlug        string     `json:"boat_slug,omitempty"`
	DepartureSlotID *uuid.UUID `json:"departure_slot_id"`
	Price           int64      `json:"price"`
}

func (h *Handler) adminList(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPackagesAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, p := range rows {
		out = append(out, map[string]any{"id": p.ID, "mode": p.Mode, "status": p.Status, "valid_from": p.ValidFrom.Format("2006-01-02"),
			"valid_until": p.ValidUntil.Format("2006-01-02"), "translations": p.Translations, "sort_order": p.SortOrder})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) adminGet(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	q := dbq.New(h.pool)
	p, err := q.GetPackageAdmin(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, catalog.ErrNotFound)
		return
	}
	offs, err := q.ListPackageOfferings(r.Context(), []uuid.UUID{id})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityPackage, []uuid.UUID{id}, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := map[string]any{"id": p.ID, "mode": p.Mode, "route_id": p.RouteID, "duration_minutes": p.DurationMinutes, "departure_id": p.DepartureID,
		"min_pax": p.MinPax, "max_pax": p.MaxPax, "valid_from": p.ValidFrom.Format("2006-01-02"), "valid_until": p.ValidUntil.Format("2006-01-02"),
		"booking_cutoff_hours": p.BookingCutoffHours, "payment_policy_id": p.PaymentPolicyID, "cancellation_policy_id": p.CancellationPolicyID,
		"sort_order": p.SortOrder, "status": p.Status, "translations": p.Translations, "thumbnail": gal.First(id, catalog.RoleThumbnail),
		"gallery": gal.All(id, catalog.RoleGallery)}
	list := []offeringDTO{}
	for _, o := range offs {
		list = append(list, offeringDTO{ID: o.ID, BoatID: o.BoatID, DepartureSlotID: o.DepartureSlotID, Price: o.Price})
	}
	out["offerings"] = list
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.CountPackageBookings(r.Context(), &id)
		if err != nil {
			return err
		}
		if n > 0 {
			return httpx.Conflict("PACKAGE_HAS_BOOKINGS", "packages with bookings cannot be deleted; archive instead")
		}
		if err := h.media.RemoveEntity(r.Context(), tx, EntityPackage, id); err != nil {
			return err
		}
		if d, err := q.DeletePackage(r.Context(), id); err != nil || d == 0 {
			if err == nil {
				return catalog.ErrNotFound
			}
			return catalog.MapWriteError(err)
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: "package.deleted", EntityType: EntityPackage, EntityID: id.String()})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type Card struct {
	ID              uuid.UUID    `json:"id"`
	Mode            string       `json:"mode"`
	Name            string       `json:"name"`
	Slug            string       `json:"slug"`
	Summary         string       `json:"summary"`
	FromPrice       int64        `json:"from_price"`
	MinPax          int32        `json:"min_pax"`
	MaxPax          int32        `json:"max_pax"`
	DurationMinutes *int32       `json:"duration_minutes"`
	ValidFrom       string       `json:"valid_from"`
	ValidUntil      string       `json:"valid_until"`
	Thumbnail       *media.Image `json:"thumbnail"`
}

func Cards(ctx context.Context, q *dbq.Queries, store storage.Store, loc string, ids []uuid.UUID, limit int32) ([]Card, error) {
	var filter []uuid.UUID
	if len(ids) > 0 {
		filter = ids
	}
	rows, err := q.ListPackagesPublic(ctx, dbq.ListPackagesPublicParams{Limit: limit, Offset: 0, Locale: loc, Ids: filter})
	if err != nil {
		return nil, err
	}
	pids := make([]uuid.UUID, 0, len(rows))
	for _, p := range rows {
		pids = append(pids, p.ID)
	}
	gal, err := media.LoadGallery(ctx, q, store, EntityPackage, pids, loc, false)
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, p := range rows {
		out = append(out, Card{ID: p.ID, Mode: p.Mode, Name: p.Name, Slug: p.Slug, Summary: p.Summary, FromPrice: p.FromPrice, MinPax: p.MinPax,
			MaxPax: p.MaxPax, DurationMinutes: p.DurationMinutes, ValidFrom: p.ValidFrom.Format("2006-01-02"), ValidUntil: p.ValidUntil.Format("2006-01-02"),
			Thumbnail: gal.First(p.ID, catalog.RoleThumbnail)})
	}
	return out, nil
}

func (h *Handler) publicList(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	cards, err := Cards(r.Context(), dbq.New(h.pool), h.store, loc, nil, 60)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cards)
}

type detailDTO struct {
	Card
	Description    string                `json:"description"`
	Inclusions     []string              `json:"inclusions"`
	Exclusions     []string              `json:"exclusions"`
	SEOTitle       string                `json:"seo_title"`
	SEODescription string                `json:"seo_description"`
	RouteID        *uuid.UUID            `json:"route_id"`
	DepartureID    *uuid.UUID            `json:"departure_id"`
	CutoffHours    int32                 `json:"booking_cutoff_hours"`
	Offerings      []offeringDTO         `json:"offerings"`
	Gallery        []media.Image         `json:"gallery"`
	Policy         catalog.PolicySummary `json:"policy"`
	Alternates     map[string]string     `json:"alternates"`
}

func (h *Handler) publicGet(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	id, err := catalog.ResolveSlug(ctx, q, EntityPackage, loc, chi.URLParam(r, "slug"), finder(q), func(id uuid.UUID) (string, error) {
		t, err := q.GetPackageTranslation(ctx, dbq.GetPackageTranslationParams{PackageID: id, Locale: loc})
		return t.Slug, err
	})
	if err != nil {
		catalog.WriteResolveError(w, r, err)
		return
	}
	p, err := q.GetPackageAdmin(ctx, id)
	if err != nil || p.Status == "DRAFT" {
		httpx.WriteError(w, r, catalog.ErrNotFound)
		return
	}
	if p.Status == "ARCHIVED" || p.ValidUntil.Before(time.Now().Truncate(24*time.Hour)) {
		httpx.WriteError(w, r, httpx.NewError(http.StatusGone, "PACKAGE_EXPIRED", "package is no longer offered"))
		return
	}
	cards, err := Cards(ctx, q, h.store, loc, []uuid.UUID{id}, 1)
	if err != nil || len(cards) == 0 {
		httpx.WriteError(w, r, catalog.ErrNotFound)
		return
	}
	var trs map[string]Translation
	_ = json.Unmarshal(p.Translations, &trs)
	t := catalog.Pick(trs, loc)
	d := detailDTO{Card: cards[0], Description: t.Description, Inclusions: t.Inclusions, Exclusions: t.Exclusions, SEOTitle: t.SEOTitle,
		SEODescription: t.SEODescription, RouteID: p.RouteID, DepartureID: p.DepartureID, CutoffHours: p.BookingCutoffHours,
		Offerings: []offeringDTO{}, Alternates: map[string]string{}}
	for l, tr := range trs {
		d.Alternates[l] = tr.Slug
	}
	if d.Inclusions == nil {
		d.Inclusions = []string{}
	}
	if d.Exclusions == nil {
		d.Exclusions = []string{}
	}
	offs, err := q.ListPackageOfferings(ctx, []uuid.UUID{id})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	boatIDs := []uuid.UUID{}
	for _, o := range offs {
		boatIDs = append(boatIDs, o.BoatID)
	}
	boats, _, err := catalog.BoatCards(ctx, q, h.store, loc, catalog.BoatFilter{IDs: boatIDs}, 100, 0)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	byID := map[uuid.UUID]catalog.BoatCard{}
	for _, b := range boats {
		byID[b.ID] = b
	}
	for _, o := range offs {
		b, ok := byID[o.BoatID]
		if !ok {
			continue
		}
		d.Offerings = append(d.Offerings, offeringDTO{ID: o.ID, BoatID: o.BoatID, BoatName: b.Name, BoatSlug: b.Slug, DepartureSlotID: o.DepartureSlotID, Price: o.Price})
	}
	gal, err := media.LoadGallery(ctx, q, h.store, EntityPackage, []uuid.UUID{id}, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d.Gallery = gal.All(id, catalog.RoleGallery)
	d.Policy, err = catalog.LoadPolicySummary(ctx, q, p.PaymentPolicyID, p.CancellationPolicyID, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func itoa(i int) string { return strconv.Itoa(i) }
