package reviews

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

const EntityReview = "review"

type Handler struct {
	pool  *pgxpool.Pool
	media *media.Service
	store storage.Store
}

func NewHandler(pool *pgxpool.Pool, m *media.Service, store storage.Store) *Handler {
	return &Handler{pool: pool, media: m, store: store}
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/reviews", h.public)
}

func (h *Handler) CustomerRoutes(r chi.Router) {
	r.Post("/bookings/{id}/review", h.create)
	r.Get("/bookings/{id}/review", h.mine)
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/reviews", h.adminList)
	r.Post("/reviews/{id}/moderate", h.moderate)
}

type input struct {
	RatingOverall int32       `json:"rating_overall"`
	RatingBoat    int32       `json:"rating_boat"`
	RatingService int32       `json:"rating_service"`
	RatingCrew    int32       `json:"rating_crew"`
	Title         string      `json:"title"`
	Body          string      `json:"body"`
	Locale        string      `json:"locale"`
	PhotoIDs      []uuid.UUID `json:"photo_ids"`
}

// create accepts one review per COMPLETED booking owned by the caller (PRD 14.2).
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in input
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	for k, v := range map[string]int32{"rating_overall": in.RatingOverall, "rating_boat": in.RatingBoat, "rating_service": in.RatingService, "rating_crew": in.RatingCrew} {
		if v < 1 || v > 5 {
			f.Add(k, "OUT_OF_RANGE")
		}
	}
	if !validate.Length(in.Title, 3, 120) {
		f.Add("title", "INVALID_LENGTH")
	}
	if !validate.Length(in.Body, 10, 4000) {
		f.Add("body", "INVALID_LENGTH")
	}
	if len(in.PhotoIDs) > 6 {
		f.Add("photo_ids", "TOO_MANY")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var rv dbq.Review
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		b, err := bookings.OwnedBooking(r, q)
		if err != nil {
			return err
		}
		if bookings.Status(b.Status) != bookings.StatusCompleted {
			return httpx.Conflict("REVIEW_NOT_ALLOWED", "only completed trips can be reviewed")
		}
		rv, err = q.InsertReview(r.Context(), dbq.InsertReviewParams{BookingID: b.ID, UserID: b.UserID, BoatID: b.BoatID, RatingOverall: in.RatingOverall,
			RatingBoat: in.RatingBoat, RatingService: in.RatingService, RatingCrew: in.RatingCrew, Title: strings.TrimSpace(in.Title),
			Body: strings.TrimSpace(in.Body), Locale: i18n.Normalize(in.Locale)})
		if db.IsUniqueViolation(err) {
			return httpx.Conflict("REVIEW_EXISTS", "this booking already has a review")
		}
		if err != nil {
			return err
		}
		return h.media.SetUsages(r.Context(), tx, EntityReview, rv.ID, "photo", in.PhotoIDs)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"id": rv.ID, "status": rv.Status})
}

func (h *Handler) mine(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rv, err := q.GetReviewByBooking(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("REVIEW_NOT_FOUND"))
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": rv.ID, "status": rv.Status, "title": rv.Title, "body": rv.Body, "rating_overall": rv.RatingOverall,
		"rating_boat": rv.RatingBoat, "rating_service": rv.RatingService, "rating_crew": rv.RatingCrew, "created_at": rv.CreatedAt})
}

type PublicReview struct {
	ID            uuid.UUID     `json:"id"`
	BoatID        uuid.UUID     `json:"boat_id"`
	AuthorName    string        `json:"author_name"`
	AuthorCountry string        `json:"author_country"`
	RatingOverall int32         `json:"rating_overall"`
	RatingBoat    int32         `json:"rating_boat"`
	RatingService int32         `json:"rating_service"`
	RatingCrew    int32         `json:"rating_crew"`
	Title         string        `json:"title"`
	Body          string        `json:"body"`
	Locale        string        `json:"locale"`
	Verified      bool          `json:"verified_booking"`
	CreatedAt     time.Time     `json:"created_at"`
	Photos        []media.Image `json:"photos"`
}

// shortName shows reviewers as "John S." to limit exposure of personal data.
func shortName(full string) string {
	parts := strings.Fields(full)
	if len(parts) == 0 {
		return "Guest"
	}
	if len(parts) == 1 {
		return parts[0]
	}
	last := []rune(parts[len(parts)-1])
	return parts[0] + " " + string(last[0]) + "."
}

func List(ctx context.Context, q *dbq.Queries, store storage.Store, loc string, boatID *uuid.UUID, featuredOnly bool, limit, offset int32) ([]PublicReview, error) {
	rows, err := q.ListReviewsPublic(ctx, dbq.ListReviewsPublicParams{Limit: limit, Offset: offset, BoatID: boatID, FeaturedOnly: featuredOnly})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	gal, err := media.LoadGallery(ctx, q, store, EntityReview, ids, loc, false)
	if err != nil {
		return nil, err
	}
	out := make([]PublicReview, 0, len(rows))
	for _, r := range rows {
		out = append(out, PublicReview{ID: r.ID, BoatID: r.BoatID, AuthorName: shortName(r.AuthorName), AuthorCountry: r.AuthorCountry, RatingOverall: r.RatingOverall,
			RatingBoat: r.RatingBoat, RatingService: r.RatingService, RatingCrew: r.RatingCrew, Title: r.Title, Body: r.Body, Locale: r.Locale,
			Verified: true, CreatedAt: r.CreatedAt, Photos: gal.All(r.ID, "photo")})
	}
	return out, nil
}

func (h *Handler) public(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	page := httpx.ParsePage(r, 10, 50)
	loc := i18n.Normalize(qs.Get("locale"))
	boatID := catalog.IDs(strp(qs.Get("boat_id")))
	q := dbq.New(h.pool)
	list, err := List(r.Context(), q, h.store, loc, boatID, qs.Get("featured") == "true", int32(page.PerPage), int32(page.Offset()))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var stats any
	if boatID != nil {
		s, err := q.ReviewStats(r.Context(), *boatID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		stats = s
	}
	httpx.JSONMeta(w, http.StatusOK, list, map[string]any{"page": page.Page, "per_page": page.PerPage, "stats": stats})
}

func strp(s string) *string { return &s }

func (h *Handler) adminList(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 25, 100)
	var status *string
	if s := r.URL.Query().Get("status"); s != "" {
		status = &s
	}
	q := dbq.New(h.pool)
	rows, err := q.ListReviewsAdmin(r.Context(), dbq.ListReviewsAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Status: status})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountReviewsAdmin(r.Context(), status)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, rows, page)
}

type moderateInput struct {
	Status     string `json:"status"`
	IsFeatured bool   `json:"is_featured"`
}

func (h *Handler) moderate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("REVIEW_NOT_FOUND"))
		return
	}
	var in moderateInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.Status != "PUBLISHED" && in.Status != "REJECTED" && in.Status != "PENDING" {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"status": "INVALID"}))
		return
	}
	if in.Status != "PUBLISHED" {
		in.IsFeatured = false
	}
	actor := auth.FromContext(r.Context()).UserID
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.ModerateReview(r.Context(), dbq.ModerateReviewParams{ID: id, Status: in.Status, IsFeatured: in.IsFeatured, ModeratedBy: &actor}); err != nil {
			if db.IsNoRows(err) {
				return httpx.NotFound("REVIEW_NOT_FOUND")
			}
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "review.moderated", EntityType: EntityReview, EntityID: id.String(), After: in})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}
