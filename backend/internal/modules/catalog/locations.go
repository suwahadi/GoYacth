package catalog

import (
	"context"
	"encoding/json"
	"net/http"
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
	"goyacht/internal/platform/validate"
)

const (
	EntityRegion = "region"
	EntityRoute  = "route"
	EntityBoat   = "boat"
	EntityArea   = "area"

	RoleThumbnail = "thumbnail"
	RoleGallery   = "gallery"
)

func validStatus(s string) bool { return s == "DRAFT" || s == "PUBLISHED" || s == "ARCHIVED" }

type LocationHandler struct {
	pool  *pgxpool.Pool
	media *media.Service
	store storage.Store
}

func NewLocationHandler(pool *pgxpool.Pool, m *media.Service, store storage.Store) *LocationHandler {
	return &LocationHandler{pool: pool, media: m, store: store}
}

func (h *LocationHandler) AdminRoutes(r chi.Router) {
	r.Get("/regions", h.adminRegions)
	r.Get("/regions/{id}", h.adminRegion)
	r.Post("/regions", h.saveRegion)
	r.Put("/regions/{id}", h.saveRegion)
	r.Delete("/regions/{id}", h.deleteRegion)

	r.Get("/ports", h.adminPorts)
	r.Post("/ports", h.savePort)
	r.Put("/ports/{id}", h.savePort)
	r.Delete("/ports/{id}", h.deletePort)

	r.Get("/routes", h.adminRoutes)
	r.Get("/routes/{id}", h.adminRoute)
	r.Post("/routes", h.saveRoute)
	r.Put("/routes/{id}", h.saveRoute)
	r.Delete("/routes/{id}", h.deleteRoute)
}

func (h *LocationHandler) PublicRoutes(r chi.Router) {
	r.Get("/regions", h.publicRegions)
	r.Get("/regions/{slug}", h.publicRegion)
	r.Get("/routes", h.publicRoutes)
	r.Get("/routes/{slug}", h.publicRoute)
}

type mediaInput struct {
	ThumbnailID *uuid.UUID  `json:"thumbnail_id"`
	GalleryIDs  []uuid.UUID `json:"gallery_ids"`
}

func (h *LocationHandler) saveMedia(ctx context.Context, tx pgx.Tx, entity string, id uuid.UUID, in mediaInput) error {
	var thumb []uuid.UUID
	if in.ThumbnailID != nil {
		thumb = []uuid.UUID{*in.ThumbnailID}
	}
	if err := h.media.SetUsages(ctx, tx, entity, id, RoleThumbnail, thumb); err != nil {
		return err
	}
	if len(in.GalleryIDs) > 30 {
		return httpx.Validation(map[string]string{"gallery_ids": "TOO_MANY"})
	}
	return h.media.SetUsages(ctx, tx, entity, id, RoleGallery, in.GalleryIDs)
}

// saveTranslations writes each locale's translation with a unique slug and records redirects
// for slugs that changed.
func saveTranslations(ctx context.Context, q *dbq.Queries, entity string, id uuid.UUID, trs Translations, find SlugFinder,
	current func(locale string) (string, error), upsert func(locale string, tr Translation, slug string) error,
) error {
	for loc, tr := range trs {
		slug, err := UniqueSlug(ctx, find, id, loc, tr.Slug, tr.Name)
		if err != nil {
			return err
		}
		old, err := current(loc)
		if err != nil && !db.IsNoRows(err) {
			return err
		}
		if err := upsert(loc, tr, slug); err != nil {
			return err
		}
		if err := RecordSlugChange(ctx, q, entity, loc, old, slug, id); err != nil {
			return err
		}
	}
	return nil
}

type regionAdminDTO struct {
	ID           uuid.UUID       `json:"id"`
	SortOrder    int32           `json:"sort_order"`
	Status       string          `json:"status"`
	Translations json.RawMessage `json:"translations"`
	Thumbnail    *media.Image    `json:"thumbnail"`
	Gallery      []media.Image   `json:"gallery"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

func (h *LocationHandler) adminRegions(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	rows, err := q.ListRegionsAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, x := range rows {
		ids = append(ids, x.ID)
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRegion, ids, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]regionAdminDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, regionAdminDTO{ID: x.ID, SortOrder: x.SortOrder, Status: x.Status, Translations: x.Translations,
			Thumbnail: gal.First(x.ID, RoleThumbnail), Gallery: gal.All(x.ID, RoleGallery), UpdatedAt: x.UpdatedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *LocationHandler) adminRegion(w http.ResponseWriter, r *http.Request) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	q := dbq.New(h.pool)
	x, err := q.GetRegionAdmin(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, MapWriteError(err))
		return
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRegion, []uuid.UUID{id}, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, regionAdminDTO{ID: x.ID, SortOrder: x.SortOrder, Status: x.Status, Translations: x.Translations,
		Thumbnail: gal.First(x.ID, RoleThumbnail), Gallery: gal.All(x.ID, RoleGallery), UpdatedAt: x.UpdatedAt})
}

type regionInput struct {
	SortOrder    int32        `json:"sort_order"`
	Status       string       `json:"status"`
	Translations Translations `json:"translations"`
	mediaInput
}

func (h *LocationHandler) saveRegion(w http.ResponseWriter, r *http.Request) {
	var in regionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	in.Translations = in.Translations.Trimmed()
	in.Translations.Validate(f, "", true)
	if !validStatus(in.Status) {
		f.Add("status", "INVALID")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := withAuditTx(r, h.pool, "region.saved", EntityRegion, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		var row dbq.Region
		var err error
		if idParam == "" {
			row, err = q.InsertRegion(r.Context(), dbq.InsertRegionParams{SortOrder: in.SortOrder, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			row, err = q.UpdateRegion(r.Context(), dbq.UpdateRegionParams{ID: id, SortOrder: in.SortOrder, Status: in.Status})
		}
		if err != nil {
			return "", nil, err
		}
		saved = row.ID
		err = saveTranslations(r.Context(), q, EntityRegion, row.ID, in.Translations, RegionSlugFinder(q),
			func(loc string) (string, error) {
				t, err := q.GetRegionTranslation(r.Context(), dbq.GetRegionTranslationParams{RegionID: row.ID, Locale: loc})
				return t.Slug, err
			},
			func(loc string, tr Translation, slug string) error {
				return q.UpsertRegionTranslation(r.Context(), dbq.UpsertRegionTranslationParams{RegionID: row.ID, Locale: loc, Name: tr.Name, Slug: slug,
					Description: tr.Description, SeoTitle: tr.SEOTitle, SeoDescription: tr.SEODescription})
			})
		if err != nil {
			return "", nil, err
		}
		if err := h.saveMedia(r.Context(), tx, EntityRegion, row.ID, in.mediaInput); err != nil {
			return "", nil, err
		}
		return row.ID.String(), in, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *LocationHandler) deleteRegion(w http.ResponseWriter, r *http.Request) {
	h.deleteWithMedia(w, r, EntityRegion, func(ctx context.Context, q *dbq.Queries, id uuid.UUID) (int64, error) { return q.DeleteRegion(ctx, id) })
}

func (h *LocationHandler) deleteWithMedia(w http.ResponseWriter, r *http.Request, entity string, del func(ctx context.Context, q *dbq.Queries, id uuid.UUID) (int64, error)) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = withAuditTx(r, h.pool, entity+".deleted", entity, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		if err := h.media.RemoveEntity(r.Context(), tx, entity, id); err != nil {
			return "", nil, err
		}
		n, err := del(r.Context(), q, id)
		if db.IsForeignKeyViolation(err) {
			return "", nil, ErrInUse
		}
		if err == nil && n == 0 {
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

type portDTO struct {
	ID           uuid.UUID       `json:"id"`
	RegionID     uuid.UUID       `json:"region_id"`
	Address      string          `json:"address"`
	Latitude     *float64        `json:"latitude"`
	Longitude    *float64        `json:"longitude"`
	Timezone     string          `json:"timezone"`
	Status       string          `json:"status"`
	Translations json.RawMessage `json:"translations"`
}

func (h *LocationHandler) adminPorts(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPorts(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]portDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, portDTO{ID: p.ID, RegionID: p.RegionID, Address: p.Address, Latitude: p.Latitude, Longitude: p.Longitude, Timezone: p.Timezone, Status: p.Status, Translations: p.Translations})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type portInput struct {
	RegionID  uuid.UUID         `json:"region_id"`
	Address   string            `json:"address"`
	Latitude  *float64          `json:"latitude"`
	Longitude *float64          `json:"longitude"`
	Timezone  string            `json:"timezone"`
	Status    string            `json:"status"`
	Names     map[string]string `json:"names"`
}

func (h *LocationHandler) savePort(w http.ResponseWriter, r *http.Request) {
	var in portInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if _, err := time.LoadLocation(in.Timezone); err != nil || in.Timezone == "" || in.Timezone == "Local" {
		f.Add("timezone", "INVALID_TIMEZONE")
	}
	if !validate.Length(in.Names[i18n.Default], 2, 120) {
		f.Add("names."+i18n.Default, "REQUIRED")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := withAuditTx(r, h.pool, "port.saved", "port", func(_ pgx.Tx, q *dbq.Queries) (string, any, error) {
		var row dbq.Port
		var err error
		if idParam == "" {
			row, err = q.InsertPort(r.Context(), dbq.InsertPortParams{RegionID: in.RegionID, Address: in.Address, Latitude: in.Latitude, Longitude: in.Longitude, Timezone: in.Timezone, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			row, err = q.UpdatePort(r.Context(), dbq.UpdatePortParams{ID: id, RegionID: in.RegionID, Address: in.Address, Latitude: in.Latitude, Longitude: in.Longitude, Timezone: in.Timezone, Status: in.Status})
		}
		if err != nil {
			return "", nil, err
		}
		saved = row.ID
		for loc, name := range in.Names {
			if !i18n.Valid(loc) || name == "" {
				continue
			}
			if err := q.UpsertPortTranslation(r.Context(), dbq.UpsertPortTranslationParams{PortID: row.ID, Locale: loc, Name: name}); err != nil {
				return "", nil, err
			}
		}
		return row.ID.String(), in, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *LocationHandler) deletePort(w http.ResponseWriter, r *http.Request) {
	deleteWith(w, r, h.pool, "port", func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error) { return q.DeletePort(ctx, id) })
}

type StopTranslation struct {
	Name     string `json:"name"`
	Activity string `json:"activity"`
}

type stopInput struct {
	Latitude     *float64                   `json:"latitude"`
	Longitude    *float64                   `json:"longitude"`
	Translations map[string]StopTranslation `json:"translations"`
}

type routeInput struct {
	RegionID        uuid.UUID    `json:"region_id"`
	DeparturePortID uuid.UUID    `json:"departure_port_id"`
	ReturnPortID    uuid.UUID    `json:"return_port_id"`
	DurationMinutes int32        `json:"duration_minutes"`
	Status          string       `json:"status"`
	Translations    Translations `json:"translations"`
	Stops           []stopInput  `json:"stops"`
	mediaInput
}

type routeAdminDTO struct {
	ID              uuid.UUID       `json:"id"`
	RegionID        uuid.UUID       `json:"region_id"`
	DeparturePortID uuid.UUID       `json:"departure_port_id"`
	ReturnPortID    uuid.UUID       `json:"return_port_id"`
	DurationMinutes int32           `json:"duration_minutes"`
	Status          string          `json:"status"`
	Translations    json.RawMessage `json:"translations"`
	Stops           []stopDTO       `json:"stops"`
	Thumbnail       *media.Image    `json:"thumbnail"`
	Gallery         []media.Image   `json:"gallery"`
}

type stopDTO struct {
	ID           uuid.UUID       `json:"id"`
	SortOrder    int32           `json:"sort_order"`
	Latitude     *float64        `json:"latitude"`
	Longitude    *float64        `json:"longitude"`
	Translations json.RawMessage `json:"translations,omitempty"`
	Name         string          `json:"name,omitempty"`
	Activity     string          `json:"activity,omitempty"`
}

func loadStops(ctx context.Context, q *dbq.Queries, routeIDs []uuid.UUID, locale string) (map[uuid.UUID][]stopDTO, error) {
	rows, err := q.ListRouteStops(ctx, routeIDs)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]stopDTO{}
	for _, s := range rows {
		d := stopDTO{ID: s.ID, SortOrder: s.SortOrder, Latitude: s.Latitude, Longitude: s.Longitude}
		if locale == "" {
			d.Translations = s.Translations
		} else {
			var m map[string]StopTranslation
			_ = json.Unmarshal(s.Translations, &m)
			t := Pick(m, locale)
			d.Name, d.Activity = t.Name, t.Activity
		}
		out[s.RouteID] = append(out[s.RouteID], d)
	}
	return out, nil
}

func (h *LocationHandler) adminRoutes(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	rows, err := q.ListRoutesAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]routeAdminDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, routeAdminDTO{ID: x.ID, RegionID: x.RegionID, DeparturePortID: x.DeparturePortID, ReturnPortID: x.ReturnPortID,
			DurationMinutes: x.DurationMinutes, Status: x.Status, Translations: x.Translations, Stops: []stopDTO{}, Gallery: []media.Image{}})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *LocationHandler) adminRoute(w http.ResponseWriter, r *http.Request) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	q := dbq.New(h.pool)
	x, err := q.GetRouteAdmin(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, MapWriteError(err))
		return
	}
	stops, err := loadStops(r.Context(), q, []uuid.UUID{id}, "")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRoute, []uuid.UUID{id}, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	st := stops[id]
	if st == nil {
		st = []stopDTO{}
	}
	httpx.JSON(w, http.StatusOK, routeAdminDTO{ID: x.ID, RegionID: x.RegionID, DeparturePortID: x.DeparturePortID, ReturnPortID: x.ReturnPortID,
		DurationMinutes: x.DurationMinutes, Status: x.Status, Translations: x.Translations, Stops: st,
		Thumbnail: gal.First(id, RoleThumbnail), Gallery: gal.All(id, RoleGallery)})
}

func (h *LocationHandler) saveRoute(w http.ResponseWriter, r *http.Request) {
	var in routeInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	in.Translations = in.Translations.Trimmed()
	in.Translations.Validate(f, "", true)
	if !validStatus(in.Status) {
		f.Add("status", "INVALID")
	}
	if in.DurationMinutes <= 0 || in.DurationMinutes > 60*24*14 {
		f.Add("duration_minutes", "OUT_OF_RANGE")
	}
	if len(in.Stops) > 50 {
		f.Add("stops", "TOO_MANY")
	}
	for i, s := range in.Stops {
		if !validate.Length(s.Translations[i18n.Default].Name, 1, 160) {
			f.Add("stops."+itoa(i)+".name", "REQUIRED")
		}
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := withAuditTx(r, h.pool, "route.saved", EntityRoute, func(tx pgx.Tx, q *dbq.Queries) (string, any, error) {
		for _, pid := range []uuid.UUID{in.DeparturePortID, in.ReturnPortID} {
			p, err := q.GetPort(r.Context(), pid)
			if err != nil {
				return "", nil, ErrInvalidRef
			}
			if p.RegionID != in.RegionID && pid == in.DeparturePortID {
				return "", nil, httpx.Validation(map[string]string{"departure_port_id": "PORT_NOT_IN_REGION"})
			}
		}
		var row dbq.Route
		var err error
		if idParam == "" {
			row, err = q.InsertRoute(r.Context(), dbq.InsertRouteParams{RegionID: in.RegionID, DeparturePortID: in.DeparturePortID, ReturnPortID: in.ReturnPortID, DurationMinutes: in.DurationMinutes, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			row, err = q.UpdateRoute(r.Context(), dbq.UpdateRouteParams{ID: id, RegionID: in.RegionID, DeparturePortID: in.DeparturePortID, ReturnPortID: in.ReturnPortID, DurationMinutes: in.DurationMinutes, Status: in.Status})
		}
		if err != nil {
			return "", nil, err
		}
		saved = row.ID
		err = saveTranslations(r.Context(), q, EntityRoute, row.ID, in.Translations, RouteSlugFinder(q),
			func(loc string) (string, error) {
				t, err := q.GetRouteTranslation(r.Context(), dbq.GetRouteTranslationParams{RouteID: row.ID, Locale: loc})
				return t.Slug, err
			},
			func(loc string, tr Translation, slug string) error {
				return q.UpsertRouteTranslation(r.Context(), dbq.UpsertRouteTranslationParams{RouteID: row.ID, Locale: loc, Name: tr.Name, Slug: slug,
					Description: tr.Description, SeoTitle: tr.SEOTitle, SeoDescription: tr.SEODescription})
			})
		if err != nil {
			return "", nil, err
		}
		if err := q.DeleteRouteStops(r.Context(), row.ID); err != nil {
			return "", nil, err
		}
		for i, s := range in.Stops {
			stopID, err := q.InsertRouteStop(r.Context(), dbq.InsertRouteStopParams{RouteID: row.ID, SortOrder: int32(i), Latitude: s.Latitude, Longitude: s.Longitude})
			if err != nil {
				return "", nil, err
			}
			for loc, t := range s.Translations {
				if !i18n.Valid(loc) || t.Name == "" {
					continue
				}
				if err := q.UpsertRouteStopTranslation(r.Context(), dbq.UpsertRouteStopTranslationParams{StopID: stopID, Locale: loc, Name: t.Name, Activity: t.Activity}); err != nil {
					return "", nil, err
				}
			}
		}
		if err := h.saveMedia(r.Context(), tx, EntityRoute, row.ID, in.mediaInput); err != nil {
			return "", nil, err
		}
		return row.ID.String(), in, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *LocationHandler) deleteRoute(w http.ResponseWriter, r *http.Request) {
	h.deleteWithMedia(w, r, EntityRoute, func(ctx context.Context, q *dbq.Queries, id uuid.UUID) (int64, error) { return q.DeleteRoute(ctx, id) })
}

type RegionCard struct {
	ID          uuid.UUID    `json:"id"`
	Name        string       `json:"name"`
	Slug        string       `json:"slug"`
	Locale      string       `json:"locale"`
	Description string       `json:"description"`
	Thumbnail   *media.Image `json:"thumbnail"`
}

func (h *LocationHandler) publicRegions(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	out, err := RegionCards(r.Context(), dbq.New(h.pool), h.store, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func RegionCards(ctx context.Context, q *dbq.Queries, store storage.Store, loc string) ([]RegionCard, error) {
	rows, err := q.ListRegionsPublic(ctx, loc)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, x := range rows {
		ids = append(ids, x.ID)
	}
	gal, err := media.LoadGallery(ctx, q, store, EntityRegion, ids, loc, false)
	if err != nil {
		return nil, err
	}
	out := make([]RegionCard, 0, len(rows))
	for _, x := range rows {
		out = append(out, RegionCard{ID: x.ID, Name: x.Name, Slug: x.Slug, Locale: x.Locale, Description: x.Description, Thumbnail: gal.First(x.ID, RoleThumbnail)})
	}
	return out, nil
}

// ResolveSlug finds the entity for a public slug, or reports the slug it was renamed to so the
// SSR layer can issue a 301.
func ResolveSlug(ctx context.Context, q *dbq.Queries, entity, locale, slug string, find SlugFinder,
	currentSlug func(id uuid.UUID) (string, error),
) (uuid.UUID, error) {
	id, err := find(ctx, locale, slug)
	if err != nil {
		return uuid.Nil, err
	}
	if id != uuid.Nil {
		return id, nil
	}
	target, err := q.FindSlugRedirect(ctx, dbq.FindSlugRedirectParams{EntityType: entity, Locale: locale, OldSlug: slug})
	if err != nil {
		if db.IsNoRows(err) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, err
	}
	newSlug, err := currentSlug(target)
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	return uuid.Nil, &MovedError{Slug: newSlug}
}

// MovedError tells the client the resource now lives under another slug.
type MovedError struct{ Slug string }

func (e *MovedError) Error() string { return "moved to " + e.Slug }

func WriteResolveError(w http.ResponseWriter, r *http.Request, err error) {
	if m, ok := err.(*MovedError); ok {
		httpx.JSON(w, http.StatusOK, map[string]string{"redirect_slug": m.Slug})
		return
	}
	httpx.WriteError(w, r, err)
}

type regionDetail struct {
	RegionCard
	SEOTitle       string            `json:"seo_title"`
	SEODescription string            `json:"seo_description"`
	Gallery        []media.Image     `json:"gallery"`
	Alternates     map[string]string `json:"alternates"`
}

func (h *LocationHandler) publicRegion(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	id, err := ResolveSlug(r.Context(), q, EntityRegion, loc, chi.URLParam(r, "slug"), RegionSlugFinder(q), func(id uuid.UUID) (string, error) {
		t, err := q.GetRegionTranslation(r.Context(), dbq.GetRegionTranslationParams{RegionID: id, Locale: loc})
		return t.Slug, err
	})
	if err != nil {
		WriteResolveError(w, r, err)
		return
	}
	x, err := q.GetRegionAdmin(r.Context(), id)
	if err != nil || x.Status != "PUBLISHED" {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	var trs map[string]Translation
	_ = json.Unmarshal(x.Translations, &trs)
	t := Pick(trs, loc)
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRegion, []uuid.UUID{id}, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	alt := map[string]string{}
	for l, tr := range trs {
		alt[l] = tr.Slug
	}
	httpx.JSON(w, http.StatusOK, regionDetail{
		RegionCard: RegionCard{ID: id, Name: t.Name, Slug: t.Slug, Locale: loc, Description: t.Description, Thumbnail: gal.First(id, RoleThumbnail)},
		SEOTitle:   t.SEOTitle, SEODescription: t.SEODescription, Gallery: gal.All(id, RoleGallery), Alternates: alt,
	})
}

type RouteCard struct {
	ID              uuid.UUID    `json:"id"`
	RegionID        uuid.UUID    `json:"region_id"`
	Name            string       `json:"name"`
	Slug            string       `json:"slug"`
	Description     string       `json:"description"`
	DurationMinutes int32        `json:"duration_minutes"`
	Thumbnail       *media.Image `json:"thumbnail"`
}

func (h *LocationHandler) publicRoutes(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	region := IDs(strPtr(r.URL.Query().Get("region_id")))
	q := dbq.New(h.pool)
	rows, err := q.ListRoutesPublic(r.Context(), dbq.ListRoutesPublicParams{Locale: loc, RegionID: region})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, x := range rows {
		ids = append(ids, x.ID)
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRoute, ids, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]RouteCard, 0, len(rows))
	for _, x := range rows {
		out = append(out, RouteCard{ID: x.ID, RegionID: x.RegionID, Name: x.Name, Slug: x.Slug, Description: x.Description, DurationMinutes: x.DurationMinutes, Thumbnail: gal.First(x.ID, RoleThumbnail)})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type routeDetail struct {
	RouteCard
	SEOTitle       string            `json:"seo_title"`
	SEODescription string            `json:"seo_description"`
	DeparturePort  PortInfo          `json:"departure_port"`
	ReturnPort     PortInfo          `json:"return_port"`
	Stops          []stopDTO         `json:"stops"`
	Gallery        []media.Image     `json:"gallery"`
	Alternates     map[string]string `json:"alternates"`
}

type PortInfo struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Timezone  string    `json:"timezone"`
	Address   string    `json:"address"`
	Latitude  *float64  `json:"latitude"`
	Longitude *float64  `json:"longitude"`
}

// LoadPorts returns localized port info for the given IDs from a single query.
func LoadPorts(ctx context.Context, q *dbq.Queries, loc string) (map[uuid.UUID]PortInfo, error) {
	rows, err := q.ListPorts(ctx)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]PortInfo{}
	for _, p := range rows {
		var names map[string]struct{ Name string }
		_ = json.Unmarshal(p.Translations, &names)
		out[p.ID] = PortInfo{ID: p.ID, Name: Pick(names, loc).Name, Timezone: p.Timezone, Address: p.Address, Latitude: p.Latitude, Longitude: p.Longitude}
	}
	return out, nil
}

func (h *LocationHandler) publicRoute(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	id, err := ResolveSlug(r.Context(), q, EntityRoute, loc, chi.URLParam(r, "slug"), RouteSlugFinder(q), func(id uuid.UUID) (string, error) {
		t, err := q.GetRouteTranslation(r.Context(), dbq.GetRouteTranslationParams{RouteID: id, Locale: loc})
		return t.Slug, err
	})
	if err != nil {
		WriteResolveError(w, r, err)
		return
	}
	x, err := q.GetRouteAdmin(r.Context(), id)
	if err != nil || x.Status != "PUBLISHED" {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	var trs map[string]Translation
	_ = json.Unmarshal(x.Translations, &trs)
	t := Pick(trs, loc)
	stops, err := loadStops(r.Context(), q, []uuid.UUID{id}, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ports, err := LoadPorts(r.Context(), q, loc)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityRoute, []uuid.UUID{id}, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	alt := map[string]string{}
	for l, tr := range trs {
		alt[l] = tr.Slug
	}
	st := stops[id]
	if st == nil {
		st = []stopDTO{}
	}
	httpx.JSON(w, http.StatusOK, routeDetail{
		RouteCard: RouteCard{ID: id, RegionID: x.RegionID, Name: t.Name, Slug: t.Slug, Description: t.Description, DurationMinutes: x.DurationMinutes, Thumbnail: gal.First(id, RoleThumbnail)},
		SEOTitle:  t.SEOTitle, SEODescription: t.SEODescription, DeparturePort: ports[x.DeparturePortID], ReturnPort: ports[x.ReturnPortID],
		Stops: st, Gallery: gal.All(id, RoleGallery), Alternates: alt,
	})
}

func withAuditTx(r *http.Request, pool *pgxpool.Pool, action, entityType string, fn func(tx pgx.Tx, q *dbq.Queries) (string, any, error)) error {
	return withAuditGeneric(r, pool, action, entityType, fn)
}

func strPtr(s string) *string { return &s }

func itoa(i int) string { return fmtInt(i) }
