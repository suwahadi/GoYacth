package cms

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

const EntityPage = "page"
const EntitySection = "page_section"

// HomeExtras lets other modules contribute data to the homepage without cms importing them.
type HomeExtras struct {
	PackageCards func(ctx context.Context, q *dbq.Queries, loc string, ids []uuid.UUID) (any, error)
	FeaturedRevs func(ctx context.Context, q *dbq.Queries, loc string, limit int32) (any, error)
}

type Handler struct {
	pool   *pgxpool.Pool
	media  *media.Service
	store  storage.Store
	extras HomeExtras
}

func NewHandler(pool *pgxpool.Pool, m *media.Service, store storage.Store, extras HomeExtras) *Handler {
	return &Handler{pool: pool, media: m, store: store, extras: extras}
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/pages", h.adminPages)
	r.Get("/pages/{id}", h.adminPage)
	r.Post("/pages", h.savePage)
	r.Put("/pages/{id}", h.savePage)
	r.Delete("/pages/{id}", h.deletePage)
	r.Get("/sections", h.adminSections)
	r.Post("/sections", h.saveSection)
	r.Put("/sections/{id}", h.saveSection)
	r.Delete("/sections/{id}", h.deleteSection)
	r.Get("/faqs", h.adminFaqs)
	r.Post("/faqs", h.saveFaq)
	r.Put("/faqs/{id}", h.saveFaq)
	r.Delete("/faqs/{id}", h.deleteFaq)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/pages/{slug}", h.publicPage)
	r.Get("/faqs", h.publicFaqs)
	r.Get("/home", h.home)
	r.Get("/sitemap", h.sitemap)
}

// Block is one unit of structured page content. Free HTML is never accepted.
type Block struct {
	Type    string       `json:"type"`
	Level   int          `json:"level,omitempty"`
	Text    string       `json:"text,omitempty"`
	Items   []string     `json:"items,omitempty"`
	MediaID *uuid.UUID   `json:"media_id,omitempty"`
	Label   string       `json:"label,omitempty"`
	URL     string       `json:"url,omitempty"`
	Image   *media.Image `json:"image,omitempty"`
}

func validateBlocks(blocks []Block, f httpx.FieldErrors, prefix string) {
	if len(blocks) > 200 {
		f.Add(prefix, "TOO_MANY")
	}
	for i, b := range blocks {
		p := prefix + "." + itoa(i)
		switch b.Type {
		case "heading":
			if b.Level < 2 || b.Level > 4 || !validate.Length(b.Text, 1, 200) {
				f.Add(p, "INVALID_HEADING")
			}
		case "paragraph", "quote":
			if !validate.Length(b.Text, 1, 10000) {
				f.Add(p, "INVALID_TEXT")
			}
		case "list":
			if len(b.Items) == 0 || len(b.Items) > 50 {
				f.Add(p, "INVALID_LIST")
			}
		case "image":
			if b.MediaID == nil {
				f.Add(p, "MEDIA_REQUIRED")
			}
		case "cta":
			if !validate.Length(b.Label, 1, 80) || !safeURL(b.URL) {
				f.Add(p, "INVALID_CTA")
			}
		default:
			f.Add(p, "UNKNOWN_BLOCK")
		}
	}
}

func safeURL(u string) bool {
	return strings.HasPrefix(u, "/") && !strings.HasPrefix(u, "//") || strings.HasPrefix(u, "https://")
}

// reservedSlugs are the first path segments the site already serves. Pages live at the root, so a
// page with one of these slugs could never be reached. TestReservedSlugsCoverRoutes keeps the list
// in step with routes.ts; api, media and metrics come from the Caddyfile, assets and home are
// folders of static files.
var reservedSlugs = []string{
	"account", "admin", "api", "assets", "boats", "checkout", "departures", "destinations", "faq", "home",
	"login", "media", "metrics", "orders", "packages", "reset-password", "routes", "track", "verify", "verify-email",
}

// IsReservedSlug also covers locale codes, which prefix every localized URL.
func IsReservedSlug(slug string) bool {
	return slices.Contains(reservedSlugs, slug) || i18n.Valid(slug)
}

type PageTranslation struct {
	Title          string  `json:"title"`
	Slug           string  `json:"slug"`
	Blocks         []Block `json:"blocks"`
	SEOTitle       string  `json:"seo_title"`
	SEODescription string  `json:"seo_description"`
}

type pageInput struct {
	Status       string                     `json:"status"`
	Translations map[string]PageTranslation `json:"translations"`
	FeaturedID   *uuid.UUID                 `json:"featured_image_id"`
}

type pageAdminDTO struct {
	ID           uuid.UUID       `json:"id"`
	Status       string          `json:"status"`
	PublishedAt  *time.Time      `json:"published_at"`
	Translations json.RawMessage `json:"translations"`
	Featured     *media.Image    `json:"featured_image"`
	BlockImages  []media.Image   `json:"block_images,omitempty"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

func (h *Handler) adminPages(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPagesAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]pageAdminDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, pageAdminDTO{ID: p.ID, Status: p.Status, PublishedAt: p.PublishedAt, Translations: p.Translations, UpdatedAt: p.UpdatedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) adminPage(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	q := dbq.New(h.pool)
	p, err := q.GetPageAdmin(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, catalog.MapWriteError(err))
		return
	}
	gal, err := media.LoadGallery(r.Context(), q, h.store, EntityPage, []uuid.UUID{id}, i18n.Default, true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, pageAdminDTO{ID: p.ID, Status: p.Status, PublishedAt: p.PublishedAt, Translations: p.Translations, Featured: gal.First(id, "featured"), BlockImages: gal.All(id, "block"), UpdatedAt: p.UpdatedAt})
}

func blockMediaIDs(trs map[string]PageTranslation) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	var out []uuid.UUID
	for _, t := range trs {
		for _, b := range t.Blocks {
			if b.Type == "image" && b.MediaID != nil && !seen[*b.MediaID] {
				seen[*b.MediaID] = true
				out = append(out, *b.MediaID)
			}
		}
	}
	return out
}

func (h *Handler) savePage(w http.ResponseWriter, r *http.Request) {
	var in pageInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if in.Status != "DRAFT" && in.Status != "PUBLISHED" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if _, ok := in.Translations[i18n.Default]; !ok {
		f.Add("translations."+i18n.Default, "REQUIRED")
	}
	for loc, t := range in.Translations {
		if !i18n.Valid(loc) {
			f.Add("translations."+loc, "INVALID_LOCALE")
			continue
		}
		p := "translations." + loc
		if !validate.Length(t.Title, 1, 160) {
			f.Add(p+".title", "INVALID_LENGTH")
		}
		if t.Slug != "" && !validate.Slug(t.Slug) {
			f.Add(p+".slug", "INVALID_SLUG")
		}
		validateBlocks(t.Blocks, f, p+".blocks")
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
		var publishedAt *time.Time
		if in.Status == "PUBLISHED" {
			now := time.Now()
			publishedAt = &now
		}
		var p dbq.Page
		var err error
		if idParam == "" {
			p, err = q.InsertPage(ctx, dbq.InsertPageParams{Status: in.Status, PublishedAt: publishedAt})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return catalog.ErrNotFound
			}
			existing, gerr := q.GetPageAdmin(ctx, id)
			if gerr != nil {
				return catalog.MapWriteError(gerr)
			}
			if existing.PublishedAt != nil && in.Status == "PUBLISHED" {
				publishedAt = existing.PublishedAt
			}
			p, err = q.UpdatePage(ctx, dbq.UpdatePageParams{ID: id, Status: in.Status, PublishedAt: publishedAt})
		}
		if err != nil {
			return err
		}
		saved = p.ID
		finder := func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
			if IsReservedSlug(slug) {
				return uuid.Max, nil // no page has this ID, so UniqueSlug treats the slug as taken
			}
			id, err := q.FindPageBySlug(ctx, dbq.FindPageBySlugParams{Locale: locale, Slug: slug})
			if db.IsNoRows(err) {
				return uuid.Nil, nil
			}
			return id, err
		}
		for loc, t := range in.Translations {
			taken := httpx.Validation(map[string]string{"translations." + loc + ".slug": "SLUG_TAKEN"})
			slug, err := catalog.UniqueSlug(ctx, finder, p.ID, loc, t.Slug, t.Title)
			if err != nil {
				return err
			}
			// Only a slug derived from the title may get a number; a typed one means exactly that URL.
			if t.Slug != "" && slug != media.Slugify(t.Slug) {
				return taken
			}
			old, err := q.GetPageTranslation(ctx, dbq.GetPageTranslationParams{PageID: p.ID, Locale: loc})
			if err != nil && !db.IsNoRows(err) {
				return err
			}
			for i := range t.Blocks {
				t.Blocks[i].Image = nil
			}
			blocks, _ := json.Marshal(t.Blocks)
			if err := q.UpsertPageTranslation(ctx, dbq.UpsertPageTranslationParams{PageID: p.ID, Locale: loc, Title: strings.TrimSpace(t.Title), Slug: slug,
				Blocks: blocks, SeoTitle: t.SEOTitle, SeoDescription: t.SEODescription}); db.IsUniqueViolation(err) {
				return taken // a concurrent save took the slug after the check above
			} else if err != nil {
				return err
			}
			if err := catalog.RecordSlugChange(ctx, q, EntityPage, loc, old.Slug, slug, p.ID); err != nil {
				return err
			}
		}
		var featured []uuid.UUID
		if in.FeaturedID != nil {
			featured = []uuid.UUID{*in.FeaturedID}
		}
		if err := h.media.SetUsages(ctx, tx, EntityPage, p.ID, "featured", featured); err != nil {
			return err
		}
		if err := h.media.SetUsages(ctx, tx, EntityPage, p.ID, "block", blockMediaIDs(in.Translations)); err != nil {
			return err
		}
		return recordAudit(ctx, q, r, "page.saved", EntityPage, p.ID.String(), map[string]string{"status": in.Status})
	})
	if err != nil {
		httpx.WriteError(w, r, catalog.MapWriteError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

func (h *Handler) deletePage(w http.ResponseWriter, r *http.Request) {
	id, err := catalog.ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := h.media.RemoveEntity(r.Context(), tx, EntityPage, id); err != nil {
			return err
		}
		n, err := q.DeletePage(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return catalog.ErrNotFound
		}
		return recordAudit(r.Context(), q, r, "page.deleted", EntityPage, id.String(), nil)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type publicPageDTO struct {
	ID             uuid.UUID         `json:"id"`
	Title          string            `json:"title"`
	Slug           string            `json:"slug"`
	Blocks         []Block           `json:"blocks"`
	SEOTitle       string            `json:"seo_title"`
	SEODescription string            `json:"seo_description"`
	Featured       *media.Image      `json:"featured_image"`
	PublishedAt    *time.Time        `json:"published_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	Alternates     map[string]string `json:"alternates"`
}

func (h *Handler) publicPage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.pool)
	finder := func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
		id, err := q.FindPageBySlug(ctx, dbq.FindPageBySlugParams{Locale: locale, Slug: slug})
		if db.IsNoRows(err) {
			return uuid.Nil, nil
		}
		return id, err
	}
	id, err := catalog.ResolveSlug(ctx, q, EntityPage, loc, chi.URLParam(r, "slug"), finder, func(id uuid.UUID) (string, error) {
		t, err := q.GetPageTranslation(ctx, dbq.GetPageTranslationParams{PageID: id, Locale: loc})
		return t.Slug, err
	})
	if err != nil {
		catalog.WriteResolveError(w, r, err)
		return
	}
	p, err := q.GetPageAdmin(ctx, id)
	if err != nil || p.Status == "DRAFT" {
		httpx.WriteError(w, r, catalog.ErrNotFound)
		return
	}
	if p.Status == "ARCHIVED" {
		httpx.WriteError(w, r, httpx.NewError(http.StatusGone, "PAGE_ARCHIVED", "page removed"))
		return
	}
	var trs map[string]PageTranslation
	_ = json.Unmarshal(p.Translations, &trs)
	t := catalog.Pick(trs, loc)
	gal, err := media.LoadGallery(ctx, q, h.store, EntityPage, []uuid.UUID{id}, loc, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	byID := map[uuid.UUID]media.Image{}
	for _, img := range gal.All(id, "block") {
		byID[img.ID] = img
	}
	for i, b := range t.Blocks {
		if b.Type == "image" && b.MediaID != nil {
			if img, ok := byID[*b.MediaID]; ok {
				t.Blocks[i].Image = &img
			}
		}
	}
	alt := map[string]string{}
	for l, tr := range trs {
		alt[l] = tr.Slug
	}
	if t.Blocks == nil {
		t.Blocks = []Block{}
	}
	httpx.JSON(w, http.StatusOK, publicPageDTO{ID: id, Title: t.Title, Slug: t.Slug, Blocks: t.Blocks, SEOTitle: t.SEOTitle, SEODescription: t.SEODescription,
		Featured: gal.First(id, "featured"), PublishedAt: p.PublishedAt, UpdatedAt: p.UpdatedAt, Alternates: alt})
}
