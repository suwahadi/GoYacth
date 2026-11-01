package catalog

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

// Translation is the shared shape of per-locale content edited in admin forms.
type Translation struct {
	Name           string `json:"name"`
	Slug           string `json:"slug"`
	Summary        string `json:"summary"`
	Description    string `json:"description"`
	SEOTitle       string `json:"seo_title"`
	SEODescription string `json:"seo_description"`
}

type Translations map[string]Translation

// Validate requires the default locale, ignores unknown locales and checks lengths. Missing
// non-default locales fall back to the default locale on public pages.
func (t Translations) Validate(f httpx.FieldErrors, prefix string, needsSlug bool) {
	if _, ok := t[i18n.Default]; !ok {
		f.Add(prefix+"translations."+i18n.Default, "REQUIRED")
	}
	for loc, tr := range t {
		if !i18n.Valid(loc) {
			f.Add(prefix+"translations."+loc, "INVALID_LOCALE")
			continue
		}
		p := prefix + "translations." + loc + "."
		if !validate.Length(tr.Name, 1, 160) {
			f.Add(p+"name", "INVALID_LENGTH")
		}
		if needsSlug && tr.Slug != "" && !validate.Slug(tr.Slug) {
			f.Add(p+"slug", "INVALID_SLUG")
		}
		if len(tr.Summary) > 500 {
			f.Add(p+"summary", "TOO_LONG")
		}
		if len(tr.Description) > 20000 {
			f.Add(p+"description", "TOO_LONG")
		}
		if len(tr.SEOTitle) > 70 {
			f.Add(p+"seo_title", "TOO_LONG")
		}
		if len(tr.SEODescription) > 170 {
			f.Add(p+"seo_description", "TOO_LONG")
		}
	}
}

func (t Translations) Trimmed() Translations {
	out := Translations{}
	for loc, tr := range t {
		tr.Name = strings.TrimSpace(tr.Name)
		tr.Slug = strings.TrimSpace(strings.ToLower(tr.Slug))
		tr.Summary = strings.TrimSpace(tr.Summary)
		tr.SEOTitle = strings.TrimSpace(tr.SEOTitle)
		tr.SEODescription = strings.TrimSpace(tr.SEODescription)
		out[loc] = tr
	}
	return out
}

// SlugFinder returns the entity currently owning slug in locale, or uuid.Nil.
type SlugFinder func(ctx context.Context, locale, slug string) (uuid.UUID, error)

// UniqueSlug derives a slug from the requested value (or the name) and appends a numeric suffix
// until it does not collide with another entity in the same locale.
func UniqueSlug(ctx context.Context, find SlugFinder, entityID uuid.UUID, locale, requested, name string) (string, error) {
	base := media.Slugify(requested)
	if base == "" {
		base = media.Slugify(name)
	}
	if base == "" {
		base = "item"
	}
	candidate := base
	for i := 2; i < 100; i++ {
		owner, err := find(ctx, locale, candidate)
		if err != nil {
			return "", err
		}
		if owner == uuid.Nil || owner == entityID {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
	}
	return "", httpx.Conflict("SLUG_TAKEN", "could not find a free slug")
}

func noRowsNil(id uuid.UUID, err error) (uuid.UUID, error) {
	if db.IsNoRows(err) {
		return uuid.Nil, nil
	}
	return id, err
}

func BoatSlugFinder(q *dbq.Queries) SlugFinder {
	return func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
		return noRowsNil(q.FindBoatBySlug(ctx, dbq.FindBoatBySlugParams{Locale: locale, Slug: slug}))
	}
}

func RegionSlugFinder(q *dbq.Queries) SlugFinder {
	return func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
		return noRowsNil(q.FindRegionBySlug(ctx, dbq.FindRegionBySlugParams{Locale: locale, Slug: slug}))
	}
}

func RouteSlugFinder(q *dbq.Queries) SlugFinder {
	return func(ctx context.Context, locale, slug string) (uuid.UUID, error) {
		return noRowsNil(q.FindRouteBySlug(ctx, dbq.FindRouteBySlugParams{Locale: locale, Slug: slug}))
	}
}

// RecordSlugChange stores a 301 redirect from the old slug and frees the new slug from any stale
// redirect that pointed elsewhere.
func RecordSlugChange(ctx context.Context, q *dbq.Queries, entityType, locale, oldSlug, newSlug string, id uuid.UUID) error {
	if err := q.DeleteSlugRedirect(ctx, dbq.DeleteSlugRedirectParams{EntityType: entityType, Locale: locale, OldSlug: newSlug}); err != nil {
		return err
	}
	if oldSlug == "" || oldSlug == newSlug {
		return nil
	}
	return q.InsertSlugRedirect(ctx, dbq.InsertSlugRedirectParams{EntityType: entityType, Locale: locale, OldSlug: oldSlug, EntityID: id})
}

// Pick returns the requested locale's translation or the default locale's.
func Pick[T any](m map[string]T, locale string) T {
	if v, ok := m[locale]; ok {
		return v
	}
	return m[i18n.Default]
}

func IDs(r *string) *uuid.UUID {
	if r == nil || *r == "" {
		return nil
	}
	id, err := uuid.Parse(*r)
	if err != nil {
		return nil
	}
	return &id
}
