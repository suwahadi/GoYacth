package cms

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

func itoa(i int) string { return strconv.Itoa(i) }

func recordAudit(ctx context.Context, q *dbq.Queries, r *http.Request, action, entity, id string, after any) error {
	return audit.Record(ctx, q, audit.Entry{ActorID: auth.UserIDPtr(auth.FromContext(r.Context())), Action: action, EntityType: entity, EntityID: id, After: after})
}

var sectionTypes = map[string]bool{"HERO": true, "FEATURED_BOATS": true, "REGIONS": true, "FEATURED_PACKAGES": true, "HIGHLIGHTS": true, "REVIEWS": true, "FAQ": true, "CTA": true, "PROMO_BANNER": true}

// SectionConfig holds the non-translated settings of a homepage section.
type SectionConfig struct {
	MediaID    *uuid.UUID  `json:"media_id,omitempty"`
	BoatIDs    []uuid.UUID `json:"boat_ids,omitempty"`
	RegionIDs  []uuid.UUID `json:"region_ids,omitempty"`
	PackageIDs []uuid.UUID `json:"package_ids,omitempty"`
	Limit      int32       `json:"limit,omitempty"`
	Category   string      `json:"category,omitempty"`
	StartsAt   *time.Time  `json:"starts_at,omitempty"`
	EndsAt     *time.Time  `json:"ends_at,omitempty"`
}

type SectionItem struct {
	Title string `json:"title"`
	Text  string `json:"text"`
	Icon  string `json:"icon,omitempty"`
}

// SectionContent holds the translated text of a homepage section.
type SectionContent struct {
	Title    string        `json:"title"`
	Subtitle string        `json:"subtitle"`
	Body     string        `json:"body"`
	CTALabel string        `json:"cta_label"`
	CTAURL   string        `json:"cta_url"`
	Items    []SectionItem `json:"items"`
}

type sectionInput struct {
	Type         string                    `json:"type"`
	SortOrder    int32                     `json:"sort_order"`
	IsActive     bool                      `json:"is_active"`
	Config       SectionConfig             `json:"config"`
	Translations map[string]SectionContent `json:"translations"`
}

type sectionAdminDTO struct {
	ID           uuid.UUID       `json:"id"`
	Type         string          `json:"type"`
	SortOrder    int32           `json:"sort_order"`
	IsActive     bool            `json:"is_active"`
	Config       json.RawMessage `json:"config"`
	Translations json.RawMessage `json:"translations"`
	Image        *media.Image    `json:"image"`
}

func (h *Handler) adminSections(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	rows, err := q.ListSections(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, s := range rows {
		ids = append(ids, s.ID)
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntitySection, ids, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]sectionAdminDTO, 0, len(rows))
	for _, s := range rows {
		out = append(out, sectionAdminDTO{ID: s.ID, Type: s.Type, SortOrder: s.SortOrder, IsActive: s.IsActive, Config: s.Config, Translations: s.Translations, Image: gal.First(s.ID, "image")})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) saveSection(w http.ResponseWriter, r *http.Request) {
	var in sectionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if !sectionTypes[in.Type] {
		f.Add("type", "INVALID")
	}
	if len(in.Config.BoatIDs) > 24 || len(in.Config.PackageIDs) > 24 || len(in.Config.RegionIDs) > 24 {
		f.Add("config", "TOO_MANY")
	}
	if in.Config.Limit < 0 || in.Config.Limit > 24 {
		f.Add("config.limit", "OUT_OF_RANGE")
	}
	for loc, c := range in.Translations {
		if !i18n.Valid(loc) {
			f.Add("translations."+loc, "INVALID_LOCALE")
		}
		if len(c.Title) > 160 || len(c.Subtitle) > 300 || len(c.Body) > 4000 || len(c.Items) > 12 {
			f.Add("translations."+loc, "TOO_LONG")
		}
		if c.CTAURL != "" && !safeURL(c.CTAURL) {
			f.Add("translations."+loc+".cta_url", "INVALID_URL")
		}
		if c.CTALabel != "" && !validate.Length(c.CTALabel, 1, 80) {
			f.Add("translations."+loc+".cta_label", "INVALID_LENGTH")
		}
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		ctx := r.Context()
		q := dbq.New(tx)
		cfg, _ := json.Marshal(in.Config)
		var s dbq.PageSection
		var err error
		if idParam == "" {
			s, err = q.InsertSection(ctx, dbq.InsertSectionParams{Type: in.Type, SortOrder: in.SortOrder, IsActive: in.IsActive, Config: cfg})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return catalog.ErrNotFound
			}
			s, err = q.UpdateSection(ctx, dbq.UpdateSectionParams{ID: id, Type: in.Type, SortOrder: in.SortOrder, IsActive: in.IsActive, Config: cfg})
		}
		if err != nil {
			return err
		}
		saved = s.ID
		for loc, c := range in.Translations {
			content, _ := json.Marshal(c)
			if err := q.UpsertSectionTranslation(ctx, dbq.UpsertSectionTranslationParams{SectionID: s.ID, Locale: loc, Content: content}); err != nil {
				return err
			}
		}
		var img []uuid.UUID
		if in.Config.MediaID != nil {
			img = []uuid.UUID{*in.Config.MediaID}
		}
		if err := h.media.SetUsages(ctx, tx, EntitySection, s.ID, "image", img); err != nil {
			return err
		}
		return recordAudit(ctx, q, r, "section.saved", EntitySection, s.ID.String(), in)
	})
	if err != nil {
		httpx.WriteError(w, r, catalog.MapWriteError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *Handler) deleteSection(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := h.media.RemoveEntity(r.Context(), tx, EntitySection, id); err != nil {
			return err
		}
		n, err := q.DeleteSection(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return catalog.ErrNotFound
		}
		return recordAudit(r.Context(), q, r, "section.deleted", EntitySection, id.String(), nil)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type FaqTranslation struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type faqInput struct {
	Category     string                    `json:"category"`
	BoatID       *uuid.UUID                `json:"boat_id"`
	PackageID    *uuid.UUID                `json:"package_id"`
	SortOrder    int32                     `json:"sort_order"`
	Status       string                    `json:"status"`
	Translations map[string]FaqTranslation `json:"translations"`
}

type faqAdminDTO struct {
	ID           uuid.UUID       `json:"id"`
	Category     string          `json:"category"`
	BoatID       *uuid.UUID      `json:"boat_id"`
	PackageID    *uuid.UUID      `json:"package_id"`
	SortOrder    int32           `json:"sort_order"`
	Status       string          `json:"status"`
	Translations json.RawMessage `json:"translations"`
}

func (h *Handler) adminFaqs(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListFaqsAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]faqAdminDTO, 0, len(rows))
	for _, f := range rows {
		out = append(out, faqAdminDTO{ID: f.ID, Category: f.Category, BoatID: f.BoatID, PackageID: f.PackageID, SortOrder: f.SortOrder, Status: f.Status, Translations: f.Translations})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) saveFaq(w http.ResponseWriter, r *http.Request) {
	var in faqInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	in.Category = strings.ToUpper(strings.TrimSpace(in.Category))
	f := httpx.FieldErrors{}
	if !validate.Length(in.Category, 1, 40) {
		f.Add("category", "INVALID_LENGTH")
	}
	if in.Status != "DRAFT" && in.Status != "PUBLISHED" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if t, ok := in.Translations[i18n.Default]; !ok || !validate.Length(t.Question, 3, 300) || !validate.Length(t.Answer, 1, 5000) {
		f.Add("translations."+i18n.Default, "REQUIRED")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		ctx := r.Context()
		q := dbq.New(tx)
		var row dbq.Faq
		var err error
		if idParam == "" {
			row, err = q.InsertFaq(ctx, dbq.InsertFaqParams{Category: in.Category, BoatID: in.BoatID, PackageID: in.PackageID, SortOrder: in.SortOrder, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return catalog.ErrNotFound
			}
			row, err = q.UpdateFaq(ctx, dbq.UpdateFaqParams{ID: id, Category: in.Category, BoatID: in.BoatID, PackageID: in.PackageID, SortOrder: in.SortOrder, Status: in.Status})
		}
		if err != nil {
			return err
		}
		saved = row.ID
		for loc, t := range in.Translations {
			if !i18n.Valid(loc) || strings.TrimSpace(t.Question) == "" {
				continue
			}
			if err := q.UpsertFaqTranslation(ctx, dbq.UpsertFaqTranslationParams{FaqID: row.ID, Locale: loc, Question: strings.TrimSpace(t.Question), Answer: strings.TrimSpace(t.Answer)}); err != nil {
				return err
			}
		}
		return recordAudit(ctx, q, r, "faq.saved", "faq", row.ID.String(), in)
	})
	if err != nil {
		httpx.WriteError(w, r, catalog.MapWriteError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *Handler) deleteFaq(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.DeleteFaq(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return catalog.ErrNotFound
		}
		return recordAudit(r.Context(), q, r, "faq.deleted", "faq", id.String(), nil)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type FaqDTO struct {
	ID       uuid.UUID `json:"id"`
	Category string    `json:"category"`
	Question string    `json:"question"`
	Answer   string    `json:"answer"`
}

func LoadFaqs(ctx context.Context, q *dbq.Queries, loc string, boatID, packageID *uuid.UUID, category *string, generalOnly bool) ([]FaqDTO, error) {
	rows, err := q.ListFaqsPublic(ctx, dbq.ListFaqsPublicParams{Locale: loc, BoatID: boatID, PackageID: packageID, Category: category, GeneralOnly: generalOnly})
	if err != nil {
		return nil, err
	}
	out := make([]FaqDTO, 0, len(rows))
	for _, f := range rows {
		out = append(out, FaqDTO{ID: f.ID, Category: f.Category, Question: f.Question, Answer: f.Answer})
	}
	return out, nil
}

func (h *Handler) publicFaqs(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	loc := i18n.Normalize(qs.Get("locale"))
	boatID := catalog.IDs(strp(qs.Get("boat_id")))
	pkgID := catalog.IDs(strp(qs.Get("package_id")))
	var category *string
	if c := strings.ToUpper(qs.Get("category")); c != "" {
		category = &c
	}
	out, err := LoadFaqs(r.Context(), dbq.New(h.pool), loc, boatID, pkgID, category, boatID == nil && pkgID == nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func strp(s string) *string { return &s }

type homeSection struct {
	ID      uuid.UUID      `json:"id"`
	Type    string         `json:"type"`
	Content SectionContent `json:"content"`
	Image   *media.Image   `json:"image"`
	Data    any            `json:"data,omitempty"`
}

func (h *Handler) home(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	rows, err := q.ListSections(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, s := range rows {
		ids = append(ids, s.ID)
	}
	gal, err := media.LoadGallery(ctx, q, h.store, EntitySection, ids, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	now := time.Now()
	out := []homeSection{}
	for _, s := range rows {
		if !s.IsActive {
			continue
		}
		var cfg SectionConfig
		_ = json.Unmarshal(s.Config, &cfg)
		if cfg.StartsAt != nil && now.Before(*cfg.StartsAt) || cfg.EndsAt != nil && now.After(*cfg.EndsAt) {
			continue
		}
		var trs map[string]SectionContent
		_ = json.Unmarshal(s.Translations, &trs)
		sec := homeSection{ID: s.ID, Type: s.Type, Content: catalog.Pick(trs, loc), Image: gal.First(s.ID, "image")}
		limit := cfg.Limit
		if limit == 0 {
			limit = 6
		}
		switch s.Type {
		case "FEATURED_BOATS":
			f := catalog.BoatFilter{IDs: cfg.BoatIDs}
			cards, _, err := catalog.BoatCards(ctx, q, h.store, loc, f, limit, 0)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			sec.Data = cards
		case "REGIONS":
			regions, err := catalog.RegionCards(ctx, q, h.store, loc)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if len(cfg.RegionIDs) > 0 {
				filtered := []catalog.RegionCard{}
				for _, id := range cfg.RegionIDs {
					for _, rc := range regions {
						if rc.ID == id {
							filtered = append(filtered, rc)
						}
					}
				}
				regions = filtered
			}
			sec.Data = regions
		case "FEATURED_PACKAGES":
			if h.extras.PackageCards != nil {
				sec.Data, err = h.extras.PackageCards(ctx, q, loc, cfg.PackageIDs)
				if err != nil {
					httpx.WriteError(w, r, err)
					return
				}
			}
		case "REVIEWS":
			if h.extras.FeaturedRevs != nil {
				sec.Data, err = h.extras.FeaturedRevs(ctx, q, loc, limit)
				if err != nil {
					httpx.WriteError(w, r, err)
					return
				}
			}
		case "FAQ":
			var cat *string
			if cfg.Category != "" {
				cat = &cfg.Category
			}
			sec.Data, err = LoadFaqs(ctx, q, loc, nil, nil, cat, true)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		out = append(out, sec)
	}
	httpx.JSON(w, http.StatusOK, out)
}

type sitemapEntry struct {
	Kind      string    `json:"kind"`
	Locale    string    `json:"locale"`
	Slug      string    `json:"slug"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (h *Handler) sitemap(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListSitemapEntries(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]sitemapEntry, 0, len(rows))
	for _, e := range rows {
		out = append(out, sitemapEntry{Kind: e.Kind, Locale: e.Locale, Slug: e.Slug, UpdatedAt: e.UpdatedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}
