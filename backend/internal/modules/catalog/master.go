package catalog

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

	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/validate"
)

var (
	ErrNotFound   = httpx.NotFound("NOT_FOUND")
	ErrInUse      = httpx.Conflict("ENTITY_IN_USE", "entity is referenced by other records; archive it instead")
	ErrInvalidRef = httpx.Unprocessable("INVALID_REFERENCE", "a referenced record does not exist")
)

func ParamID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	return id, nil
}

// MapWriteError converts constraint violations into stable client errors.
func MapWriteError(err error) error {
	switch {
	case err == nil:
		return nil
	case db.IsNoRows(err):
		return ErrNotFound
	case db.IsForeignKeyViolation(err):
		return ErrInvalidRef
	case db.IsCheckViolation(err):
		return httpx.Unprocessable("CONSTRAINT_VIOLATION", "values violate a business rule")
	}
	return err
}

type MasterHandler struct {
	pool *pgxpool.Pool
}

func NewMasterHandler(pool *pgxpool.Pool) *MasterHandler { return &MasterHandler{pool: pool} }

func (h *MasterHandler) AdminRoutes(r chi.Router) {
	r.Get("/partners", h.listPartners)
	r.Post("/partners", h.savePartner)
	r.Put("/partners/{id}", h.savePartner)
	r.Delete("/partners/{id}", h.deletePartner)

	r.Get("/categories", h.listCategories)
	r.Post("/categories", h.saveCategory)
	r.Put("/categories/{id}", h.saveCategory)
	r.Delete("/categories/{id}", h.deleteCategory)

	r.Get("/classes", h.listClasses)
	r.Post("/classes", h.saveClass)
	r.Put("/classes/{id}", h.saveClass)
	r.Delete("/classes/{id}", h.deleteClass)

	r.Get("/facilities", h.listFacilities)
	r.Post("/facilities", h.saveFacility)
	r.Put("/facilities/{id}", h.saveFacility)
	r.Delete("/facilities/{id}", h.deleteFacility)

	r.Get("/payment-policies", h.listPaymentPolicies)
	r.Post("/payment-policies", h.savePaymentPolicy)
	r.Put("/payment-policies/{id}", h.savePaymentPolicy)

	r.Get("/cancellation-policies", h.listCancellationPolicies)
	r.Post("/cancellation-policies", h.saveCancellationPolicy)
	r.Put("/cancellation-policies/{id}", h.saveCancellationPolicy)
}

func (h *MasterHandler) PublicRoutes(r chi.Router) {
	r.Get("/categories", h.publicCategories)
	r.Get("/classes", h.publicClasses)
	r.Get("/facilities", h.publicFacilities)
}

func withAudit(r *http.Request, pool *pgxpool.Pool, action, entityType string, fn func(q *dbq.Queries) (string, any, error)) error {
	return withAuditGeneric(r, pool, action, entityType, func(_ pgx.Tx, q *dbq.Queries) (string, any, error) { return fn(q) })
}

type partnerDTO struct {
	ID                uuid.UUID `json:"id"`
	Name              string    `json:"name"`
	ContactName       string    `json:"contact_name"`
	Email             string    `json:"email"`
	Phone             string    `json:"phone"`
	BankName          string    `json:"bank_name"`
	BankAccountName   string    `json:"bank_account_name"`
	BankAccountNumber string    `json:"bank_account_number"`
	Notes             string    `json:"notes"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
}

func toPartner(p dbq.Partner) partnerDTO {
	return partnerDTO{ID: p.ID, Name: p.Name, ContactName: p.ContactName, Email: p.Email, Phone: p.Phone, BankName: p.BankName,
		BankAccountName: p.BankAccountName, BankAccountNumber: p.BankAccountNumber, Notes: p.Notes, Status: p.Status, CreatedAt: p.CreatedAt}
}

func (h *MasterHandler) listPartners(w http.ResponseWriter, r *http.Request) {
	var status *string
	if s := r.URL.Query().Get("status"); s != "" {
		status = &s
	}
	rows, err := dbq.New(h.pool).ListPartners(r.Context(), status)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]partnerDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, toPartner(p))
	}
	httpx.JSON(w, http.StatusOK, out)
}

type partnerInput struct {
	Name              string `json:"name"`
	ContactName       string `json:"contact_name"`
	Email             string `json:"email"`
	Phone             string `json:"phone"`
	BankName          string `json:"bank_name"`
	BankAccountName   string `json:"bank_account_name"`
	BankAccountNumber string `json:"bank_account_number"`
	Notes             string `json:"notes"`
	Status            string `json:"status"`
}

func (h *MasterHandler) savePartner(w http.ResponseWriter, r *http.Request) {
	var in partnerInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if !validate.Length(in.Name, 2, 160) {
		f.Add("name", "INVALID_LENGTH")
	}
	if in.Email != "" && !validate.Email(in.Email) {
		f.Add("email", "INVALID_EMAIL")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var out dbq.Partner
	idParam := chi.URLParam(r, "id")
	err := withAudit(r, h.pool, "partner.saved", "partner", func(q *dbq.Queries) (string, any, error) {
		var err error
		if idParam == "" {
			out, err = q.InsertPartner(r.Context(), dbq.InsertPartnerParams{Name: strings.TrimSpace(in.Name), ContactName: in.ContactName, Email: in.Email, Phone: in.Phone,
				BankName: in.BankName, BankAccountName: in.BankAccountName, BankAccountNumber: in.BankAccountNumber, Notes: in.Notes, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			out, err = q.UpdatePartner(r.Context(), dbq.UpdatePartnerParams{ID: id, Name: strings.TrimSpace(in.Name), ContactName: in.ContactName, Email: in.Email, Phone: in.Phone,
				BankName: in.BankName, BankAccountName: in.BankAccountName, BankAccountNumber: in.BankAccountNumber, Notes: in.Notes, Status: in.Status})
		}
		return out.ID.String(), map[string]string{"name": out.Name, "status": out.Status}, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toPartner(out))
}

func deleteWith(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, entity string, del func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error)) {
	id, err := ParamID(r, "id")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err = withAudit(r, pool, entity+".deleted", entity, func(q *dbq.Queries) (string, any, error) {
		n, err := del(q, r.Context(), id)
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

func (h *MasterHandler) deletePartner(w http.ResponseWriter, r *http.Request) {
	deleteWith(w, r, h.pool, "partner", func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error) {
		return q.DeletePartner(ctx, id)
	})
}

type namedItemDTO struct {
	ID           uuid.UUID       `json:"id"`
	SortOrder    int32           `json:"sort_order"`
	Status       string          `json:"status,omitempty"`
	Icon         string          `json:"icon,omitempty"`
	Translations json.RawMessage `json:"translations"`
}

type namedItemInput struct {
	SortOrder    int32        `json:"sort_order"`
	Status       string       `json:"status"`
	Icon         string       `json:"icon"`
	Translations Translations `json:"translations"`
}

func (in *namedItemInput) validate(withStatus bool) error {
	f := httpx.FieldErrors{}
	in.Translations = in.Translations.Trimmed()
	in.Translations.Validate(f, "", true)
	if withStatus && in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if len(in.Icon) > 60 {
		f.Add("icon", "TOO_LONG")
	}
	return f.Err()
}

func (h *MasterHandler) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListCategories(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]namedItemDTO, 0, len(rows))
	for _, c := range rows {
		out = append(out, namedItemDTO{ID: c.ID, SortOrder: c.SortOrder, Status: c.Status, Translations: c.Translations})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *MasterHandler) saveCategory(w http.ResponseWriter, r *http.Request) {
	h.saveNamed(w, r, "category", func(ctx context.Context, q *dbq.Queries, id *uuid.UUID, in namedItemInput) (uuid.UUID, error) {
		var row dbq.BoatCategory
		var err error
		if id == nil {
			row, err = q.InsertCategory(ctx, dbq.InsertCategoryParams{SortOrder: in.SortOrder, Status: in.Status})
		} else {
			row, err = q.UpdateCategory(ctx, dbq.UpdateCategoryParams{ID: *id, SortOrder: in.SortOrder, Status: in.Status})
		}
		if err != nil {
			return uuid.Nil, err
		}
		for loc, tr := range in.Translations {
			if err := q.UpsertCategoryTranslation(ctx, dbq.UpsertCategoryTranslationParams{CategoryID: row.ID, Locale: loc, Name: tr.Name, Slug: slugOr(tr)}); err != nil {
				return uuid.Nil, slugConflict(err)
			}
		}
		return row.ID, nil
	}, true)
}

func (h *MasterHandler) deleteCategory(w http.ResponseWriter, r *http.Request) {
	deleteWith(w, r, h.pool, "category", func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error) {
		return q.DeleteCategory(ctx, id)
	})
}

func (h *MasterHandler) listClasses(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListClasses(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]namedItemDTO, 0, len(rows))
	for _, c := range rows {
		out = append(out, namedItemDTO{ID: c.ID, SortOrder: c.SortOrder, Status: c.Status, Translations: c.Translations})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *MasterHandler) saveClass(w http.ResponseWriter, r *http.Request) {
	h.saveNamed(w, r, "class", func(ctx context.Context, q *dbq.Queries, id *uuid.UUID, in namedItemInput) (uuid.UUID, error) {
		var row dbq.BoatClass
		var err error
		if id == nil {
			row, err = q.InsertClass(ctx, dbq.InsertClassParams{SortOrder: in.SortOrder, Status: in.Status})
		} else {
			row, err = q.UpdateClass(ctx, dbq.UpdateClassParams{ID: *id, SortOrder: in.SortOrder, Status: in.Status})
		}
		if err != nil {
			return uuid.Nil, err
		}
		for loc, tr := range in.Translations {
			if err := q.UpsertClassTranslation(ctx, dbq.UpsertClassTranslationParams{ClassID: row.ID, Locale: loc, Name: tr.Name, Slug: slugOr(tr)}); err != nil {
				return uuid.Nil, slugConflict(err)
			}
		}
		return row.ID, nil
	}, true)
}

func (h *MasterHandler) deleteClass(w http.ResponseWriter, r *http.Request) {
	deleteWith(w, r, h.pool, "class", func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error) { return q.DeleteClass(ctx, id) })
}

func (h *MasterHandler) listFacilities(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListFacilities(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]namedItemDTO, 0, len(rows))
	for _, f := range rows {
		out = append(out, namedItemDTO{ID: f.ID, SortOrder: f.SortOrder, Icon: f.Icon, Translations: f.Translations})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *MasterHandler) saveFacility(w http.ResponseWriter, r *http.Request) {
	h.saveNamed(w, r, "facility", func(ctx context.Context, q *dbq.Queries, id *uuid.UUID, in namedItemInput) (uuid.UUID, error) {
		var row dbq.Facility
		var err error
		if id == nil {
			row, err = q.InsertFacility(ctx, dbq.InsertFacilityParams{Icon: in.Icon, SortOrder: in.SortOrder})
		} else {
			row, err = q.UpdateFacility(ctx, dbq.UpdateFacilityParams{ID: *id, Icon: in.Icon, SortOrder: in.SortOrder})
		}
		if err != nil {
			return uuid.Nil, err
		}
		for loc, tr := range in.Translations {
			if err := q.UpsertFacilityTranslation(ctx, dbq.UpsertFacilityTranslationParams{FacilityID: row.ID, Locale: loc, Name: tr.Name}); err != nil {
				return uuid.Nil, err
			}
		}
		return row.ID, nil
	}, false)
}

func (h *MasterHandler) deleteFacility(w http.ResponseWriter, r *http.Request) {
	deleteWith(w, r, h.pool, "facility", func(q *dbq.Queries, ctx context.Context, id uuid.UUID) (int64, error) {
		return q.DeleteFacility(ctx, id)
	})
}

func slugOr(tr Translation) string {
	if tr.Slug != "" {
		return tr.Slug
	}
	return media.Slugify(tr.Name)
}

func slugConflict(err error) error {
	if db.IsUniqueViolation(err) {
		return httpx.Validation(map[string]string{"slug": "SLUG_TAKEN"})
	}
	return err
}

func (h *MasterHandler) saveNamed(w http.ResponseWriter, r *http.Request, entity string,
	save func(ctx context.Context, q *dbq.Queries, id *uuid.UUID, in namedItemInput) (uuid.UUID, error), withStatus bool,
) {
	var in namedItemInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := in.validate(withStatus); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var id *uuid.UUID
	if chi.URLParam(r, "id") != "" {
		parsed, err := ParamID(r, "id")
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id = &parsed
	}
	var saved uuid.UUID
	err := withAudit(r, h.pool, entity+".saved", entity, func(q *dbq.Queries) (string, any, error) {
		var err error
		saved, err = save(r.Context(), q, id, in)
		return saved.String(), in, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved})
}

type publicNamed struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Slug string    `json:"slug,omitempty"`
	Icon string    `json:"icon,omitempty"`
}

func localized(raw json.RawMessage, locale string) Translation {
	var m map[string]Translation
	_ = json.Unmarshal(raw, &m)
	return Pick(m, locale)
}

func (h *MasterHandler) publicCategories(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	rows, err := dbq.New(h.pool).ListCategories(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := []publicNamed{}
	for _, c := range rows {
		if c.Status == "ACTIVE" {
			t := localized(c.Translations, loc)
			out = append(out, publicNamed{ID: c.ID, Name: t.Name, Slug: t.Slug})
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *MasterHandler) publicClasses(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	rows, err := dbq.New(h.pool).ListClasses(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := []publicNamed{}
	for _, c := range rows {
		if c.Status == "ACTIVE" {
			t := localized(c.Translations, loc)
			out = append(out, publicNamed{ID: c.ID, Name: t.Name, Slug: t.Slug})
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *MasterHandler) publicFacilities(w http.ResponseWriter, r *http.Request) {
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	rows, err := dbq.New(h.pool).ListFacilities(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := []publicNamed{}
	for _, f := range rows {
		out = append(out, publicNamed{ID: f.ID, Name: localized(f.Translations, loc).Name, Icon: f.Icon})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type paymentPolicyDTO struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	DepositType    *string   `json:"deposit_type"`
	DepositValue   int64     `json:"deposit_value"`
	BalanceDueDays int32     `json:"balance_due_days"`
	Status         string    `json:"status"`
}

func toPaymentPolicy(p dbq.PaymentPolicy) paymentPolicyDTO {
	return paymentPolicyDTO{ID: p.ID, Name: p.Name, Type: p.Type, DepositType: p.DepositType, DepositValue: p.DepositValue, BalanceDueDays: p.BalanceDueDays, Status: p.Status}
}

func (h *MasterHandler) listPaymentPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPaymentPolicies(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]paymentPolicyDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, toPaymentPolicy(p))
	}
	httpx.JSON(w, http.StatusOK, out)
}

type paymentPolicyInput struct {
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	DepositType    *string `json:"deposit_type"`
	DepositValue   int64   `json:"deposit_value"`
	BalanceDueDays int32   `json:"balance_due_days"`
	Status         string  `json:"status"`
}

func (h *MasterHandler) savePaymentPolicy(w http.ResponseWriter, r *http.Request) {
	var in paymentPolicyInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if !validate.Length(in.Name, 2, 120) {
		f.Add("name", "INVALID_LENGTH")
	}
	switch in.Type {
	case "FULL":
		in.DepositType, in.DepositValue, in.BalanceDueDays = nil, 0, 0
	case "DEPOSIT":
		if in.DepositType == nil || (*in.DepositType != "PERCENTAGE" && *in.DepositType != "FIXED") {
			f.Add("deposit_type", "INVALID")
		} else if *in.DepositType == "PERCENTAGE" && (in.DepositValue <= 0 || in.DepositValue >= 10000) {
			f.Add("deposit_value", "OUT_OF_RANGE")
		}
		if in.DepositValue <= 0 {
			f.Add("deposit_value", "OUT_OF_RANGE")
		}
		if in.BalanceDueDays < 0 || in.BalanceDueDays > 365 {
			f.Add("balance_due_days", "OUT_OF_RANGE")
		}
	default:
		f.Add("type", "INVALID")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var out dbq.PaymentPolicy
	idParam := chi.URLParam(r, "id")
	err := withAudit(r, h.pool, "payment_policy.saved", "payment_policy", func(q *dbq.Queries) (string, any, error) {
		var err error
		if idParam == "" {
			out, err = q.InsertPaymentPolicy(r.Context(), dbq.InsertPaymentPolicyParams{Name: in.Name, Type: in.Type, DepositType: in.DepositType, DepositValue: in.DepositValue, BalanceDueDays: in.BalanceDueDays, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			out, err = q.UpdatePaymentPolicy(r.Context(), dbq.UpdatePaymentPolicyParams{ID: id, Name: in.Name, Type: in.Type, DepositType: in.DepositType, DepositValue: in.DepositValue, BalanceDueDays: in.BalanceDueDays, Status: in.Status})
		}
		return out.ID.String(), in, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toPaymentPolicy(out))
}

type CancellationTier struct {
	MinDaysBefore     int32 `json:"min_days_before"`
	RefundBasisPoints int32 `json:"refund_basis_points"`
}

type cancellationPolicyDTO struct {
	ID           uuid.UUID       `json:"id"`
	Name         string          `json:"name"`
	Status       string          `json:"status"`
	Tiers        json.RawMessage `json:"tiers"`
	Descriptions json.RawMessage `json:"descriptions"`
}

func (h *MasterHandler) listCancellationPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListCancellationPolicies(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]cancellationPolicyDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, cancellationPolicyDTO{ID: p.ID, Name: p.Name, Status: p.Status, Tiers: p.Tiers, Descriptions: p.Descriptions})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type cancellationPolicyInput struct {
	Name         string             `json:"name"`
	Status       string             `json:"status"`
	Tiers        []CancellationTier `json:"tiers"`
	Descriptions map[string]string  `json:"descriptions"`
}

func (h *MasterHandler) saveCancellationPolicy(w http.ResponseWriter, r *http.Request) {
	var in cancellationPolicyInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if !validate.Length(in.Name, 2, 120) {
		f.Add("name", "INVALID_LENGTH")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if len(in.Tiers) == 0 || len(in.Tiers) > 10 {
		f.Add("tiers", "INVALID")
	}
	seen := map[int32]bool{}
	hasZero := false
	for _, t := range in.Tiers {
		if t.MinDaysBefore < 0 || t.MinDaysBefore > 365 || t.RefundBasisPoints < 0 || t.RefundBasisPoints > 10000 || seen[t.MinDaysBefore] {
			f.Add("tiers", "INVALID")
		}
		seen[t.MinDaysBefore] = true
		if t.MinDaysBefore == 0 {
			hasZero = true
		}
	}
	if !hasZero {
		f.Add("tiers", "MISSING_ZERO_DAY_TIER")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idParam := chi.URLParam(r, "id")
	var saved uuid.UUID
	err := withAudit(r, h.pool, "cancellation_policy.saved", "cancellation_policy", func(q *dbq.Queries) (string, any, error) {
		var row dbq.CancellationPolicy
		var err error
		if idParam == "" {
			row, err = q.InsertCancellationPolicy(r.Context(), dbq.InsertCancellationPolicyParams{Name: in.Name, Status: in.Status})
		} else {
			id, perr := uuid.Parse(idParam)
			if perr != nil {
				return "", nil, ErrNotFound
			}
			row, err = q.UpdateCancellationPolicy(r.Context(), dbq.UpdateCancellationPolicyParams{ID: id, Name: in.Name, Status: in.Status})
		}
		if err != nil {
			return "", nil, err
		}
		saved = row.ID
		if err := q.DeleteCancellationTiers(r.Context(), row.ID); err != nil {
			return "", nil, err
		}
		for _, t := range in.Tiers {
			if err := q.InsertCancellationTier(r.Context(), dbq.InsertCancellationTierParams{PolicyID: row.ID, MinDaysBefore: t.MinDaysBefore, RefundBasisPoints: t.RefundBasisPoints}); err != nil {
				return "", nil, err
			}
		}
		for loc, d := range in.Descriptions {
			if !i18n.Valid(loc) {
				continue
			}
			if err := q.UpsertCancellationPolicyTranslation(r.Context(), dbq.UpsertCancellationPolicyTranslationParams{PolicyID: row.ID, Locale: loc, Description: strings.TrimSpace(d)}); err != nil {
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
