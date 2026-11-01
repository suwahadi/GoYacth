package pricing

import (
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

var ErrNotFound = httpx.NotFound("NOT_FOUND")

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/seasons", h.listSeasons)
	r.Post("/seasons", h.saveSeason)
	r.Put("/seasons/{id}", h.saveSeason)
	r.Delete("/seasons/{id}", h.deleteSeason)
	r.Get("/price-overrides", h.listOverrides)
	r.Post("/price-overrides", h.createOverride)
	r.Delete("/price-overrides/{id}", h.deleteOverride)
	r.Get("/promotions", h.listPromotions)
	r.Post("/promotions", h.savePromotion)
	r.Put("/promotions/{id}", h.savePromotion)
	r.Get("/tax-lines", h.listTaxLines)
	r.Post("/tax-lines", h.saveTaxLine)
	r.Put("/tax-lines/{id}", h.saveTaxLine)
	r.Get("/payment-method-fees", h.listFees)
	r.Put("/payment-method-fees/{method}", h.saveFee)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/payment-methods", h.publicMethods)
}

func (h *Handler) tx(r *http.Request, action, entity string, fn func(q *dbq.Queries) (string, any, error)) error {
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	return db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		id, after, err := fn(q)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrNotFound
			}
			if db.IsForeignKeyViolation(err) {
				return httpx.Unprocessable("INVALID_REFERENCE", "a referenced record does not exist or is in use")
			}
			if db.IsCheckViolation(err) {
				return httpx.Unprocessable("CONSTRAINT_VIOLATION", "values violate a business rule")
			}
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: action, EntityType: entity, EntityID: id, After: after})
	})
}

func idParam(r *http.Request) (*uuid.UUID, error) {
	raw := chi.URLParam(r, "id")
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, ErrNotFound
	}
	return &id, nil
}

type seasonInput struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	StartsOn string `json:"starts_on"`
	EndsOn   string `json:"ends_on"`
}

type seasonDTO struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Kind     string    `json:"kind"`
	StartsOn string    `json:"starts_on"`
	EndsOn   string    `json:"ends_on"`
}

func (h *Handler) listSeasons(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListSeasons(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]seasonDTO, 0, len(rows))
	for _, s := range rows {
		out = append(out, seasonDTO{ID: s.ID, Name: s.Name, Kind: s.Kind, StartsOn: s.StartsOn.Format("2006-01-02"), EndsOn: s.EndsOn.Format("2006-01-02")})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) saveSeason(w http.ResponseWriter, r *http.Request) {
	var in seasonInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	start, e1 := time.Parse("2006-01-02", in.StartsOn)
	end, e2 := time.Parse("2006-01-02", in.EndsOn)
	if e1 != nil {
		f.Add("starts_on", "INVALID_DATE")
	}
	if e2 != nil || end.Before(start) {
		f.Add("ends_on", "INVALID_DATE")
	}
	if in.Kind != "LOW" && in.Kind != "HIGH" && in.Kind != "PEAK" {
		f.Add("kind", "INVALID")
	}
	if !validate.Length(in.Name, 2, 80) {
		f.Add("name", "INVALID_LENGTH")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	id, err := idParam(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var saved dbq.Season
	err = h.tx(r, "season.saved", "season", func(q *dbq.Queries) (string, any, error) {
		var err error
		if id == nil {
			saved, err = q.InsertSeason(r.Context(), dbq.InsertSeasonParams{Name: in.Name, Kind: in.Kind, StartsOn: start, EndsOn: end})
		} else {
			saved, err = q.UpdateSeason(r.Context(), dbq.UpdateSeasonParams{ID: *id, Name: in.Name, Kind: in.Kind, StartsOn: start, EndsOn: end})
		}
		return saved.ID.String(), in, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved.ID})
}

func (h *Handler) deleteSeason(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil || id == nil {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	err = h.tx(r, "season.deleted", "season", func(q *dbq.Queries) (string, any, error) {
		n, err := q.DeleteSeason(r.Context(), *id)
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

type overrideInput struct {
	BoatRateID        *uuid.UUID `json:"boat_rate_id"`
	PackageOfferingID *uuid.UUID `json:"package_offering_id"`
	RuleType          string     `json:"rule_type"`
	OnDate            *string    `json:"on_date"`
	SeasonID          *uuid.UUID `json:"season_id"`
	Price             int64      `json:"price"`
}

type overrideDTO struct {
	ID                uuid.UUID  `json:"id"`
	BoatRateID        *uuid.UUID `json:"boat_rate_id"`
	PackageOfferingID *uuid.UUID `json:"package_offering_id"`
	RuleType          string     `json:"rule_type"`
	OnDate            *string    `json:"on_date"`
	SeasonID          *uuid.UUID `json:"season_id"`
	Price             int64      `json:"price"`
}

func (h *Handler) listOverrides(w http.ResponseWriter, r *http.Request) {
	parse := func(k string) *uuid.UUID {
		if id, err := uuid.Parse(r.URL.Query().Get(k)); err == nil {
			return &id
		}
		return nil
	}
	rows, err := dbq.New(h.pool).ListPriceOverrides(r.Context(), dbq.ListPriceOverridesParams{BoatRateID: parse("boat_rate_id"), PackageOfferingID: parse("package_offering_id")})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]overrideDTO, 0, len(rows))
	for _, o := range rows {
		d := overrideDTO{ID: o.ID, BoatRateID: o.BoatRateID, PackageOfferingID: o.PackageOfferingID, RuleType: o.RuleType, SeasonID: o.SeasonID, Price: o.Price}
		if o.OnDate != nil {
			s := o.OnDate.Format("2006-01-02")
			d.OnDate = &s
		}
		out = append(out, d)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createOverride(w http.ResponseWriter, r *http.Request) {
	var in overrideInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if (in.BoatRateID == nil) == (in.PackageOfferingID == nil) {
		f.Add("boat_rate_id", "EXACTLY_ONE_TARGET")
	}
	var onDate *time.Time
	switch in.RuleType {
	case "DATE":
		if in.OnDate == nil {
			f.Add("on_date", "REQUIRED")
		} else if d, err := time.Parse("2006-01-02", *in.OnDate); err != nil {
			f.Add("on_date", "INVALID_DATE")
		} else {
			onDate = &d
		}
		in.SeasonID = nil
	case "SEASON":
		if in.SeasonID == nil {
			f.Add("season_id", "REQUIRED")
		}
	case "WEEKEND", "WEEKDAY":
		in.SeasonID = nil
	default:
		f.Add("rule_type", "INVALID")
	}
	if in.Price < 0 {
		f.Add("price", "OUT_OF_RANGE")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var saved dbq.PriceOverride
	err := h.tx(r, "price_override.created", "price_override", func(q *dbq.Queries) (string, any, error) {
		var err error
		saved, err = q.InsertPriceOverride(r.Context(), dbq.InsertPriceOverrideParams{BoatRateID: in.BoatRateID, PackageOfferingID: in.PackageOfferingID,
			RuleType: in.RuleType, OnDate: onDate, SeasonID: in.SeasonID, Price: in.Price})
		return saved.ID.String(), in, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]uuid.UUID{"id": saved.ID})
}

func (h *Handler) deleteOverride(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil || id == nil {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	err = h.tx(r, "price_override.deleted", "price_override", func(q *dbq.Queries) (string, any, error) {
		n, err := q.DeletePriceOverride(r.Context(), *id)
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

type promotionInput struct {
	Name          string     `json:"name"`
	Code          *string    `json:"code"`
	IsAutomatic   bool       `json:"is_automatic"`
	DiscountType  string     `json:"discount_type"`
	DiscountValue int64      `json:"discount_value"`
	BoatID        *uuid.UUID `json:"boat_id"`
	PackageID     *uuid.UUID `json:"package_id"`
	BookingMode   *string    `json:"booking_mode"`
	MinSubtotal   int64      `json:"min_subtotal"`
	StartsAt      time.Time  `json:"starts_at"`
	EndsAt        time.Time  `json:"ends_at"`
	Quota         *int32     `json:"quota"`
	Status        string     `json:"status"`
}

func (h *Handler) listPromotions(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPromotions(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rows)
}

func (h *Handler) savePromotion(w http.ResponseWriter, r *http.Request) {
	var in promotionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if !validate.Length(in.Name, 2, 120) {
		f.Add("name", "INVALID_LENGTH")
	}
	if in.Code != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.Code))
		if c == "" {
			in.Code = nil
		} else if len(c) < 3 || len(c) > 30 || strings.ContainsAny(c, " \t") {
			f.Add("code", "INVALID")
		} else {
			in.Code = &c
		}
	}
	if !in.IsAutomatic && in.Code == nil {
		f.Add("code", "REQUIRED")
	}
	switch in.DiscountType {
	case "PERCENTAGE":
		if in.DiscountValue <= 0 || in.DiscountValue > 10000 {
			f.Add("discount_value", "OUT_OF_RANGE")
		}
	case "FIXED", "PRICE":
		if in.DiscountValue < 0 {
			f.Add("discount_value", "OUT_OF_RANGE")
		}
	default:
		f.Add("discount_type", "INVALID")
	}
	if in.BookingMode != nil && *in.BookingMode != "PRIVATE_CHARTER" && *in.BookingMode != "DEPARTURE" {
		f.Add("booking_mode", "INVALID")
	}
	if !in.EndsAt.After(in.StartsAt) {
		f.Add("ends_at", "INVALID_RANGE")
	}
	if in.Quota != nil && *in.Quota < 1 {
		f.Add("quota", "OUT_OF_RANGE")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	id, err := idParam(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var saved dbq.Promotion
	err = h.tx(r, "promotion.saved", "promotion", func(q *dbq.Queries) (string, any, error) {
		var err error
		if id == nil {
			saved, err = q.InsertPromotion(r.Context(), dbq.InsertPromotionParams{Name: in.Name, Code: in.Code, IsAutomatic: in.IsAutomatic, DiscountType: in.DiscountType,
				DiscountValue: in.DiscountValue, BoatID: in.BoatID, PackageID: in.PackageID, BookingMode: in.BookingMode, MinSubtotal: in.MinSubtotal,
				StartsAt: in.StartsAt, EndsAt: in.EndsAt, Quota: in.Quota, Status: in.Status})
		} else {
			saved, err = q.UpdatePromotion(r.Context(), dbq.UpdatePromotionParams{ID: *id, Name: in.Name, Code: in.Code, IsAutomatic: in.IsAutomatic, DiscountType: in.DiscountType,
				DiscountValue: in.DiscountValue, BoatID: in.BoatID, PackageID: in.PackageID, BookingMode: in.BookingMode, MinSubtotal: in.MinSubtotal,
				StartsAt: in.StartsAt, EndsAt: in.EndsAt, Quota: in.Quota, Status: in.Status})
		}
		if db.IsUniqueViolation(err) {
			return "", nil, httpx.Validation(map[string]string{"code": "CODE_TAKEN"})
		}
		return saved.ID.String(), in, err
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, saved)
}

type taxLineInput struct {
	Code                  string            `json:"code"`
	BasisPoints           int32             `json:"basis_points"`
	IncludesPreviousLines bool              `json:"includes_previous_lines"`
	SortOrder             int32             `json:"sort_order"`
	Status                string            `json:"status"`
	Names                 map[string]string `json:"names"`
}

func (h *Handler) listTaxLines(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListTaxLinesAdmin(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rows)
}

func (h *Handler) saveTaxLine(w http.ResponseWriter, r *http.Request) {
	var in taxLineInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	f := httpx.FieldErrors{}
	if !validate.Length(in.Code, 2, 30) {
		f.Add("code", "INVALID_LENGTH")
	}
	if in.BasisPoints < 0 || in.BasisPoints > 10000 {
		f.Add("basis_points", "OUT_OF_RANGE")
	}
	if in.Status != "ACTIVE" && in.Status != "ARCHIVED" {
		f.Add("status", "INVALID")
	}
	if strings.TrimSpace(in.Names[i18n.Default]) == "" {
		f.Add("names."+i18n.Default, "REQUIRED")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	id, err := idParam(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var saved dbq.TaxLine
	err = h.tx(r, "tax_line.saved", "tax_line", func(q *dbq.Queries) (string, any, error) {
		var err error
		if id == nil {
			saved, err = q.InsertTaxLine(r.Context(), dbq.InsertTaxLineParams{Code: in.Code, BasisPoints: in.BasisPoints, IncludesPreviousLines: in.IncludesPreviousLines, SortOrder: in.SortOrder, Status: in.Status})
		} else {
			saved, err = q.UpdateTaxLine(r.Context(), dbq.UpdateTaxLineParams{ID: *id, Code: in.Code, BasisPoints: in.BasisPoints, IncludesPreviousLines: in.IncludesPreviousLines, SortOrder: in.SortOrder, Status: in.Status})
		}
		if db.IsUniqueViolation(err) {
			return "", nil, httpx.Validation(map[string]string{"code": "CODE_TAKEN"})
		}
		if err != nil {
			return "", nil, err
		}
		for loc, n := range in.Names {
			if !i18n.Valid(loc) || strings.TrimSpace(n) == "" {
				continue
			}
			if err := q.UpsertTaxLineTranslation(r.Context(), dbq.UpsertTaxLineTranslationParams{TaxLineID: saved.ID, Locale: loc, Name: strings.TrimSpace(n)}); err != nil {
				return "", nil, err
			}
		}
		return saved.ID.String(), in, nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]uuid.UUID{"id": saved.ID})
}

type feeDTO struct {
	Method      string `json:"method"`
	FeeType     string `json:"fee_type"`
	FeeValue    int64  `json:"fee_value"`
	HoldMinutes int32  `json:"hold_minutes"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int32  `json:"sort_order"`
}

func (h *Handler) listFees(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPaymentMethodFees(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]feeDTO, 0, len(rows))
	for _, f := range rows {
		out = append(out, feeDTO{Method: f.Method, FeeType: f.FeeType, FeeValue: f.FeeValue, HoldMinutes: f.HoldMinutes, Enabled: f.Enabled, SortOrder: f.SortOrder})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) publicMethods(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPaymentMethodFees(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := []feeDTO{}
	for _, f := range rows {
		if f.Enabled {
			out = append(out, feeDTO{Method: f.Method, FeeType: f.FeeType, FeeValue: f.FeeValue, HoldMinutes: f.HoldMinutes, Enabled: true, SortOrder: f.SortOrder})
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

var methods = map[string]bool{"CREDIT_CARD": true, "QRIS": true, "BCA_VA": true, "BNI_VA": true, "BRI_VA": true, "MANDIRI_VA": true, "PERMATA_VA": true}

func (h *Handler) saveFee(w http.ResponseWriter, r *http.Request) {
	method := chi.URLParam(r, "method")
	if !methods[method] {
		httpx.WriteError(w, r, ErrNotFound)
		return
	}
	var in feeDTO
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	f := httpx.FieldErrors{}
	if in.FeeType != "FIXED" && in.FeeType != "PERCENTAGE" {
		f.Add("fee_type", "INVALID")
	}
	if in.FeeValue < 0 || (in.FeeType == "PERCENTAGE" && in.FeeValue > 10000) {
		f.Add("fee_value", "OUT_OF_RANGE")
	}
	if in.HoldMinutes < 5 || in.HoldMinutes > 1440 {
		f.Add("hold_minutes", "OUT_OF_RANGE")
	}
	if err := f.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	err := h.tx(r, "payment_method_fee.saved", "payment_method_fee", func(q *dbq.Queries) (string, any, error) {
		return method, in, q.UpsertPaymentMethodFee(r.Context(), dbq.UpsertPaymentMethodFeeParams{Method: method, FeeType: in.FeeType, FeeValue: in.FeeValue,
			HoldMinutes: in.HoldMinutes, Enabled: in.Enabled, SortOrder: in.SortOrder})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}
