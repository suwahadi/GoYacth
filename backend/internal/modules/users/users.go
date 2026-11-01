package users

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

var (
	ErrUserNotFound   = httpx.NotFound("USER_NOT_FOUND")
	ErrLastAdmin      = httpx.Conflict("LAST_ADMIN", "the last active admin cannot be deactivated")
	ErrOpenBookings   = httpx.Conflict("ACCOUNT_HAS_OPEN_BOOKINGS", "account has bookings that are not finished")
	ErrInviteExists   = httpx.Conflict("INVITE_EXISTS", "email is already invited")
	ErrInviteNotFound = httpx.NotFound("INVITE_NOT_FOUND")
	ErrCannotSelf     = httpx.Conflict("CANNOT_MODIFY_SELF", "use another admin account for this action")
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) CustomerRoutes(r chi.Router) {
	r.Get("/account/profile", h.getProfile)
	r.Put("/account/profile", h.updateProfile)
	r.Post("/account/delete", h.deleteAccount)
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/users", h.list)
	r.Get("/users/search", h.search)
	r.Get("/users/{id}", h.get)
	r.Post("/users/{id}/status", h.setStatus)
	r.Post("/users/{id}/demote", h.demote)
	r.Post("/users/{id}/anonymize", h.anonymize)
	r.Get("/admin-invites", h.listInvites)
	r.Post("/admin-invites", h.createInvite)
	r.Delete("/admin-invites/{id}", h.deleteInvite)
}

type ProfileDTO struct {
	ID          uuid.UUID  `json:"id"`
	Email       string     `json:"email"`
	FullName    string     `json:"full_name"`
	AvatarURL   string     `json:"avatar_url"`
	Phone       string     `json:"phone"`
	Nationality string     `json:"nationality"`
	Locale      string     `json:"locale"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

func toProfile(u dbq.User) ProfileDTO {
	return ProfileDTO{ID: u.ID, Email: u.Email, FullName: u.FullName, AvatarURL: u.AvatarUrl, Phone: u.Phone,
		Nationality: u.Nationality, Locale: u.PreferredLocale, Role: u.Role, Status: u.Status, LastLoginAt: u.LastLoginAt, CreatedAt: u.CreatedAt}
}

func (h *Handler) getProfile(w http.ResponseWriter, r *http.Request) {
	u, err := dbq.New(h.pool).GetUserByID(r.Context(), auth.FromContext(r.Context()).UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toProfile(u))
}

type profileInput struct {
	FullName    string `json:"full_name"`
	Phone       string `json:"phone"`
	Nationality string `json:"nationality"`
	Locale      string `json:"locale"`
}

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	var in profileInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	in.FullName = strings.TrimSpace(in.FullName)
	in.Nationality = strings.ToUpper(strings.TrimSpace(in.Nationality))
	f := httpx.FieldErrors{}
	if !validate.Length(in.FullName, 2, 120) {
		f.Add("full_name", "INVALID_LENGTH")
	}
	if in.Phone != "" && !validate.Phone(in.Phone) {
		f.Add("phone", "INVALID_PHONE")
	}
	if !validate.Country(in.Nationality) {
		f.Add("nationality", "INVALID_COUNTRY")
	}
	if !i18n.Valid(in.Locale) {
		f.Add("locale", "INVALID_LOCALE")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	u, err := dbq.New(h.pool).UpdateProfile(r.Context(), dbq.UpdateProfileParams{
		ID: auth.FromContext(r.Context()).UserID, FullName: in.FullName, Phone: in.Phone, Nationality: in.Nationality, PreferredLocale: in.Locale,
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toProfile(u))
}

func (h *Handler) deleteAccount(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	if p.IsAdmin() {
		httpx.WriteError(w, r, ErrCannotSelf)
		return
	}
	if err := Anonymize(r.Context(), h.pool, p.UserID, &p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CSRFCookieName, Value: "", Path: "/", MaxAge: -1})
	httpx.NoContent(w)
}

// Anonymize removes personal data while keeping bookings, payments and refunds intact for
// financial records (PRD 12.3, UU PDP).
func Anonymize(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, actor *uuid.UUID) error {
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetUserForUpdate(ctx, userID)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}
		if u.Role == auth.RoleAdmin {
			return ErrCannotSelf
		}
		n, err := q.CountUserOpenBookings(ctx, userID)
		if err != nil {
			return err
		}
		if n > 0 {
			return ErrOpenBookings
		}
		for _, f := range []func(context.Context, uuid.UUID) error{q.PurgeUserIdentities, q.AnonymizeUserGuests, q.AnonymizeUserBookings, q.AnonymizeUser, q.RevokeUserSessions} {
			if err := f(ctx, userID); err != nil {
				return err
			}
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "user.anonymized", EntityType: "user", EntityID: userID.String()})
	})
}

type userRow struct {
	ProfileDTO
	BookingCount int64 `json:"booking_count"`
}

func optional(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 25, 100)
	qs := r.URL.Query()
	role, status, search := optional(qs.Get("role")), optional(qs.Get("status")), optional(qs.Get("search"))
	q := dbq.New(h.pool)
	rows, err := q.ListUsers(r.Context(), dbq.ListUsersParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Role: role, Status: status, Search: search})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountUsers(r.Context(), dbq.CountUsersParams{Role: role, Status: status, Search: search})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]userRow, 0, len(rows))
	for _, u := range rows {
		out = append(out, userRow{ProfileDTO: toProfile(dbq.User{ID: u.ID, Email: u.Email, FullName: u.FullName, AvatarUrl: u.AvatarUrl, Phone: u.Phone,
			Nationality: u.Nationality, PreferredLocale: u.PreferredLocale, Role: u.Role, Status: u.Status, LastLoginAt: u.LastLoginAt, CreatedAt: u.CreatedAt}), BookingCount: u.BookingCount})
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(term) < 2 {
		httpx.JSON(w, http.StatusOK, []ProfileDTO{})
		return
	}
	rows, err := dbq.New(h.pool).SearchActiveCustomers(r.Context(), term)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]ProfileDTO, 0, len(rows))
	for _, u := range rows {
		out = append(out, toProfile(u))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, ErrUserNotFound
	}
	return id, nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	u, err := dbq.New(h.pool).GetUserByID(r.Context(), id)
	if err != nil {
		if db.IsNoRows(err) {
			err = ErrUserNotFound
		}
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toProfile(u))
}

type statusInput struct {
	Status string `json:"status"`
}

// ensureNotLastAdmin locks all active admin rows so two concurrent deactivations cannot both
// pass the check and leave zero admins.
func ensureNotLastAdmin(ctx context.Context, q *dbq.Queries, target dbq.User) error {
	if target.Role != auth.RoleAdmin || target.Status != "ACTIVE" {
		return nil
	}
	ids, err := q.LockActiveAdmins(ctx)
	if err != nil {
		return err
	}
	if len(ids) <= 1 {
		return ErrLastAdmin
	}
	return nil
}

func (h *Handler) setStatus(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in statusInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.Status != "ACTIVE" && in.Status != "DISABLED" {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"status": "INVALID"}))
		return
	}
	actor := auth.FromContext(r.Context())
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetUserForUpdate(r.Context(), id)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}
		if u.Status == "ANONYMIZED" {
			return httpx.Conflict("USER_ANONYMIZED", "anonymized users cannot be changed")
		}
		if in.Status == "DISABLED" {
			if err := ensureNotLastAdmin(r.Context(), q, u); err != nil {
				return err
			}
			if err := q.RevokeUserSessions(r.Context(), id); err != nil {
				return err
			}
		}
		if _, err := q.SetUserStatus(r.Context(), dbq.SetUserStatusParams{ID: id, Status: in.Status}); err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor.UserID, Action: "user.status_changed", EntityType: "user", EntityID: id.String(),
			Before: map[string]string{"status": u.Status}, After: map[string]string{"status": in.Status}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) demote(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.FromContext(r.Context())
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetUserForUpdate(r.Context(), id)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}
		if u.Role != auth.RoleAdmin {
			return nil
		}
		if err := ensureNotLastAdmin(r.Context(), q, u); err != nil {
			return err
		}
		if _, err := q.SetUserRole(r.Context(), dbq.SetUserRoleParams{ID: id, Role: auth.RoleCustomer}); err != nil {
			return err
		}
		if err := q.RevokeUserSessions(r.Context(), id); err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor.UserID, Action: "user.demoted", EntityType: "user", EntityID: id.String(),
			Before: map[string]string{"role": auth.RoleAdmin}, After: map[string]string{"role": auth.RoleCustomer}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) anonymize(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := Anonymize(r.Context(), h.pool, id, auth.UserIDPtr(auth.FromContext(r.Context()))); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type inviteDTO struct {
	ID         uuid.UUID  `json:"id"`
	Email      string     `json:"email"`
	AcceptedAt *time.Time `json:"accepted_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (h *Handler) listInvites(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListAdminInvites(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]inviteDTO, 0, len(rows))
	for _, i := range rows {
		out = append(out, inviteDTO{ID: i.ID, Email: i.Email, AcceptedAt: i.AcceptedAt, CreatedAt: i.CreatedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type inviteInput struct {
	Email string `json:"email"`
}

func (h *Handler) createInvite(w http.ResponseWriter, r *http.Request) {
	var in inviteInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if !validate.Email(in.Email) {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"email": "INVALID_EMAIL"}))
		return
	}
	actor := auth.FromContext(r.Context())
	var inv dbq.AdminInvite
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		inv, err = q.InsertAdminInvite(r.Context(), dbq.InsertAdminInviteParams{Email: in.Email, InvitedBy: &actor.UserID})
		if db.IsUniqueViolation(err) {
			return ErrInviteExists
		}
		if err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor.UserID, Action: "admin_invite.created", EntityType: "admin_invite", EntityID: inv.ID.String(), After: map[string]string{"email": in.Email}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, inviteDTO{ID: inv.ID, Email: inv.Email, CreatedAt: inv.CreatedAt})
}

func (h *Handler) deleteInvite(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, ErrInviteNotFound)
		return
	}
	actor := auth.FromContext(r.Context())
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.DeleteAdminInvite(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrInviteNotFound
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor.UserID, Action: "admin_invite.deleted", EntityType: "admin_invite", EntityID: id.String()})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}
