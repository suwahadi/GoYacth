package media

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/i18n"
)

type Source struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type Image struct {
	ID      uuid.UUID         `json:"id"`
	Status  string            `json:"status"`
	Alt     string            `json:"alt"`
	AltAll  map[string]string `json:"alt_texts,omitempty"`
	Width   int               `json:"width"`
	Height  int               `json:"height"`
	Sources []Source          `json:"sources"`
}

func ToImage(store storage.Store, m dbq.Medium, alts map[string]string, locale string) Image {
	img := Image{ID: m.ID, Status: m.Status, Alt: alts[locale], Sources: []Source{}}
	if img.Alt == "" {
		img.Alt = alts[i18n.Default]
	}
	if m.Width != nil {
		img.Width = int(*m.Width)
	}
	if m.Height != nil {
		img.Height = int(*m.Height)
	}
	var variants []Variant
	_ = json.Unmarshal(m.Variants, &variants)
	if m.Bucket == string(storage.Public) {
		for _, v := range variants {
			img.Sources = append(img.Sources, Source{URL: store.PublicURL(v.Key), Width: v.Width, Height: v.Height})
		}
	}
	return img
}

// Gallery maps entity ID -> role -> ordered images.
type Gallery map[uuid.UUID]map[string][]Image

func (g Gallery) First(id uuid.UUID, role string) *Image {
	imgs := g[id][role]
	if len(imgs) == 0 {
		return nil
	}
	return &imgs[0]
}

func (g Gallery) All(id uuid.UUID, role string) []Image {
	if imgs := g[id][role]; imgs != nil {
		return imgs
	}
	return []Image{}
}

// LoadGallery fetches every image used by the given entities with three queries, regardless of
// how many entities are requested. includeAllAlts adds every locale's alt text (admin forms).
func LoadGallery(ctx context.Context, q *dbq.Queries, store storage.Store, entityType string, ids []uuid.UUID, locale string, includeAllAlts bool) (Gallery, error) {
	out := Gallery{}
	if len(ids) == 0 {
		return out, nil
	}
	usages, err := q.ListMediaUsages(ctx, dbq.ListMediaUsagesParams{EntityType: entityType, EntityIds: ids})
	if err != nil {
		return nil, err
	}
	if len(usages) == 0 {
		return out, nil
	}
	mediaIDs := make([]uuid.UUID, 0, len(usages))
	for _, u := range usages {
		mediaIDs = append(mediaIDs, u.MediaID)
	}
	rows, err := q.ListMediaByIDs(ctx, mediaIDs)
	if err != nil {
		return nil, err
	}
	trs, err := q.ListMediaTranslations(ctx, mediaIDs)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]dbq.Medium{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	alts := map[uuid.UUID]map[string]string{}
	for _, t := range trs {
		if alts[t.MediaID] == nil {
			alts[t.MediaID] = map[string]string{}
		}
		alts[t.MediaID][t.Locale] = t.AltText
	}
	for _, u := range usages {
		m, ok := byID[u.MediaID]
		if !ok || m.Status != "READY" && !includeAllAlts {
			continue
		}
		img := ToImage(store, m, alts[m.ID], locale)
		if includeAllAlts {
			img.AltAll = alts[m.ID]
		}
		if out[u.EntityID] == nil {
			out[u.EntityID] = map[string][]Image{}
		}
		out[u.EntityID][u.Role] = append(out[u.EntityID][u.Role], img)
	}
	return out, nil
}
