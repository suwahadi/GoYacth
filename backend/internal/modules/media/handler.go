package media

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

type Handler struct {
	svc   *Service
	pool  *pgxpool.Pool
	store storage.Store
}

func NewHandler(svc *Service, pool *pgxpool.Pool, store storage.Store) *Handler {
	return &Handler{svc: svc, pool: pool, store: store}
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/media", h.list)
	r.Post("/media", h.upload)
	r.Get("/media/{id}", h.get)
	r.Patch("/media/{id}", h.updateAlt)
	r.Get("/files/{id}", h.privateFile)
}

// ReadUpload reads a multipart "file" part, enforcing the size limit before buffering.
func ReadUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes+1<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return nil, ErrFileTooLarge
		}
		return nil, httpx.BadRequest("MULTIPART_INVALID", "expected multipart/form-data with a file field")
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		return nil, httpx.Validation(map[string]string{"file": "REQUIRED"})
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(io.LimitReader(f, MaxUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxUploadBytes {
		return nil, ErrFileTooLarge
	}
	return data, nil
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	data, err := ReadUpload(w, r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	alts := map[string]string{}
	for _, loc := range i18n.Supported {
		alts[loc] = r.FormValue("alt_" + loc)
	}
	bucket := storage.Public
	if r.FormValue("private") == "true" {
		bucket = storage.Private
	}
	m, err := h.svc.Upload(r.Context(), UploadInput{
		Data: data, Slug: r.FormValue("slug"), Bucket: bucket, AltTexts: alts, ActorID: auth.UserIDPtr(auth.FromContext(r.Context())),
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusAccepted, ToImage(h.store, m, alts, i18n.Default))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, ErrMediaNotFound)
		return
	}
	q := dbq.New(h.pool)
	m, err := q.GetMedia(r.Context(), id)
	if err != nil {
		if db.IsNoRows(err) {
			err = ErrMediaNotFound
		}
		httpx.WriteError(w, r, err)
		return
	}
	trs, err := q.ListMediaTranslations(r.Context(), []uuid.UUID{id})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	alts := map[string]string{}
	for _, t := range trs {
		alts[t.Locale] = t.AltText
	}
	img := ToImage(h.store, m, alts, i18n.Default)
	img.AltAll = alts
	httpx.JSON(w, http.StatusOK, map[string]any{"image": img, "failure_reason": m.FailureReason})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 40, 100)
	q := dbq.New(h.pool)
	rows, err := q.ListMediaAdmin(r.Context(), dbq.ListMediaAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset())})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountMediaAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, m := range rows {
		ids = append(ids, m.ID)
	}
	trs, err := q.ListMediaTranslations(r.Context(), ids)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	alts := map[uuid.UUID]map[string]string{}
	for _, t := range trs {
		if alts[t.MediaID] == nil {
			alts[t.MediaID] = map[string]string{}
		}
		alts[t.MediaID][t.Locale] = t.AltText
	}
	out := make([]Image, 0, len(rows))
	for _, m := range rows {
		img := ToImage(h.store, m, alts[m.ID], i18n.Default)
		img.AltAll = alts[m.ID]
		out = append(out, img)
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

type altInput struct {
	AltTexts map[string]string `json:"alt_texts"`
}

func (h *Handler) updateAlt(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, ErrMediaNotFound)
		return
	}
	var in altInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := h.svc.UpdateAltText(r.Context(), auth.UserIDPtr(auth.FromContext(r.Context())), id, in.AltTexts); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

// privateFile streams a private object (payment or transfer proof) to an admin. Streaming through
// the API keeps the private bucket unreachable from the internet.
func (h *Handler) privateFile(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, ErrMediaNotFound)
		return
	}
	m, err := dbq.New(h.pool).GetMedia(r.Context(), id)
	if err != nil || m.Bucket != string(storage.Private) || m.Status != "READY" {
		httpx.WriteError(w, r, ErrMediaNotFound)
		return
	}
	var variants []Variant
	if err := json.Unmarshal(m.Variants, &variants); err != nil || len(variants) == 0 {
		httpx.WriteError(w, r, ErrMediaNotFound)
		return
	}
	largest := variants[len(variants)-1]
	data, err := h.store.Get(r.Context(), storage.Private, largest.Key)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", "inline")
	_, _ = w.Write(data)
}
