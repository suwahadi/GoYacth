package settings

import (
	"context"
	"encoding/json"
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
)

type Site struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	WhatsApp string `json:"whatsapp"`
	Address  string `json:"address"`
}

type SEO struct {
	DefaultTitle       string     `json:"default_title"`
	DefaultDescription string     `json:"default_description"`
	OGImageMediaID     *uuid.UUID `json:"og_image_media_id"`
}

type Analytics struct {
	GA4ID string `json:"ga4_id"`
	GTMID string `json:"gtm_id"`
}

type Booking struct {
	MinLeadHours          int   `json:"min_lead_hours"`
	MaxAdvanceDays        int   `json:"max_advance_days"`
	AdminHoldMinutes      int   `json:"admin_hold_minutes"`
	BalanceReminderDays   []int `json:"balance_reminder_days"`
	IdentityRetentionDays int   `json:"identity_retention_days"`
}

type Currency struct {
	USDRateIDR int64 `json:"usd_rate_idr"`
}

type Legal struct {
	TermsVersion        string `json:"terms_version"`
	PrivacyVersion      string `json:"privacy_version"`
	CancellationVersion string `json:"cancellation_version"`
}

func DefaultBooking() Booking {
	return Booking{MinLeadHours: 24, MaxAdvanceDays: 365, AdminHoldMinutes: 1440, BalanceReminderDays: []int{3, 1}, IdentityRetentionDays: 90}
}

func Load[T any](ctx context.Context, q *dbq.Queries, key string, def T) (T, error) {
	row, err := q.GetSetting(ctx, key)
	if err != nil {
		if db.IsNoRows(err) {
			return def, nil
		}
		return def, err
	}
	out := def
	if err := json.Unmarshal(row.Value, &out); err != nil {
		return def, err
	}
	return out, nil
}

func validateValue(key string, raw json.RawMessage) (any, error) {
	f := httpx.FieldErrors{}
	switch key {
	case "site":
		var v Site
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		if strings.TrimSpace(v.Name) == "" {
			f.Add("name", "REQUIRED")
		}
		return v, f.Err()
	case "seo":
		var v SEO
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		if len(v.DefaultTitle) > 70 {
			f.Add("default_title", "TOO_LONG")
		}
		if len(v.DefaultDescription) > 170 {
			f.Add("default_description", "TOO_LONG")
		}
		return v, f.Err()
	case "analytics":
		var v Analytics
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		if v.GA4ID != "" && !strings.HasPrefix(v.GA4ID, "G-") {
			f.Add("ga4_id", "INVALID")
		}
		if v.GTMID != "" && !strings.HasPrefix(v.GTMID, "GTM-") {
			f.Add("gtm_id", "INVALID")
		}
		return v, f.Err()
	case "booking":
		var v Booking
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		if v.MinLeadHours < 0 || v.MinLeadHours > 24*30 {
			f.Add("min_lead_hours", "OUT_OF_RANGE")
		}
		if v.MaxAdvanceDays < 1 || v.MaxAdvanceDays > 730 {
			f.Add("max_advance_days", "OUT_OF_RANGE")
		}
		if v.AdminHoldMinutes < 15 || v.AdminHoldMinutes > 7*24*60 {
			f.Add("admin_hold_minutes", "OUT_OF_RANGE")
		}
		if v.IdentityRetentionDays < 1 || v.IdentityRetentionDays > 3650 {
			f.Add("identity_retention_days", "OUT_OF_RANGE")
		}
		for _, d := range v.BalanceReminderDays {
			if d < 0 || d > 60 {
				f.Add("balance_reminder_days", "OUT_OF_RANGE")
			}
		}
		return v, f.Err()
	case "currency":
		var v Currency
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		if v.USDRateIDR < 0 || v.USDRateIDR > 1_000_000 {
			f.Add("usd_rate_idr", "OUT_OF_RANGE")
		}
		return v, f.Err()
	case "legal":
		var v Legal
		if err := strict(raw, &v); err != nil {
			return nil, err
		}
		return v, nil
	}
	return nil, httpx.NotFound("SETTING_NOT_FOUND")
}

func strict(raw json.RawMessage, dst any) error {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return httpx.ErrInvalidJSON
	}
	return nil
}

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/settings/public", h.public)
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/settings", h.list)
	r.Put("/settings/{key}", h.update)
	r.Get("/audit-logs", h.auditLogs)
}

var publicKeys = map[string]bool{"site": true, "seo": true, "analytics": true, "currency": true, "legal": true, "booking": true}

func (h *Handler) public(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListSettings(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := map[string]json.RawMessage{}
	for _, s := range rows {
		if publicKeys[s.Key] {
			out[s.Key] = s.Value
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=60")
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListSettings(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := map[string]json.RawMessage{}
	for _, s := range rows {
		out[s.Key] = s.Value
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	var raw json.RawMessage
	if err := httpx.Decode(w, r, &raw); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	v, err := validateValue(key, raw)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	value, _ := json.Marshal(v)
	actor := auth.FromContext(r.Context())
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		before, err := q.GetSetting(r.Context(), key)
		if err != nil && !db.IsNoRows(err) {
			return err
		}
		if err := q.UpsertSetting(r.Context(), dbq.UpsertSettingParams{Key: key, Value: value, UpdatedBy: &actor.UserID}); err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor.UserID, Action: "settings.updated", EntityType: "setting", EntityID: key,
			Before: json.RawMessage(before.Value), After: json.RawMessage(value)})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, json.RawMessage(value))
}

type auditDTO struct {
	ID         int64           `json:"id"`
	ActorEmail *string         `json:"actor_email"`
	Action     string          `json:"action"`
	EntityType string          `json:"entity_type"`
	EntityID   string          `json:"entity_id"`
	Before     json.RawMessage `json:"before"`
	After      json.RawMessage `json:"after"`
	RequestID  string          `json:"request_id"`
	IPAddress  string          `json:"ip_address"`
	CreatedAt  string          `json:"created_at"`
}

func (h *Handler) auditLogs(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 50, 200)
	qs := r.URL.Query()
	opt := func(k string) *string {
		if v := strings.TrimSpace(qs.Get(k)); v != "" {
			return &v
		}
		return nil
	}
	var actor *uuid.UUID
	if a := qs.Get("actor_id"); a != "" {
		if id, err := uuid.Parse(a); err == nil {
			actor = &id
		}
	}
	optTime := func(k string) *time.Time {
		if t, err := time.Parse(time.RFC3339, qs.Get(k)); err == nil {
			return &t
		}
		return nil
	}
	from, to := optTime("from"), optTime("to")
	q := dbq.New(h.pool)
	rows, err := q.ListAuditLogs(r.Context(), dbq.ListAuditLogsParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), EntityType: opt("entity_type"), EntityID: opt("entity_id"), ActorID: actor,
		Action: opt("action"), ActorEmail: opt("actor_email"), FromTime: from, ToTime: to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountAuditLogs(r.Context(), dbq.CountAuditLogsParams{EntityType: opt("entity_type"), EntityID: opt("entity_id"), ActorID: actor,
		Action: opt("action"), ActorEmail: opt("actor_email"), FromTime: from, ToTime: to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]auditDTO, 0, len(rows))
	for _, a := range rows {
		out = append(out, auditDTO{ID: a.ID, ActorEmail: a.ActorEmail, Action: a.Action, EntityType: a.EntityType, EntityID: a.EntityID,
			Before: a.Before, After: a.After, RequestID: a.RequestID, IPAddress: a.IpAddress, CreatedAt: a.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")})
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}
