package reports

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"

	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/overview", h.overview)
	r.Get("/reports/{kind}", h.report)
}

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
}

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	loc, _ := time.LoadLocation("Asia/Makassar")
	now := time.Now().In(loc)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	week := day.AddDate(0, 0, -int((day.Weekday()+6)%7))
	q := dbq.New(h.pool)
	counts, err := q.OverviewCounts(r.Context(), dbq.OverviewCountsParams{DayStart: day, WeekStart: week, MonthStart: monthStart(now)})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	upcoming, err := q.UpcomingDepartures(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	type up struct {
		ID            uuid.UUID `json:"id"`
		BookingNumber string    `json:"booking_number"`
		Mode          string    `json:"mode"`
		StartsAt      time.Time `json:"starts_at"`
		Timezone      string    `json:"timezone"`
		Pax           int32     `json:"pax"`
		BoatName      string    `json:"boat_name"`
	}
	list := make([]up, 0, len(upcoming))
	for _, b := range upcoming {
		snap := bookings.LoadSnapshot(dbq.Booking{Snapshot: b.Snapshot})
		list = append(list, up{ID: b.PublicID, BookingNumber: b.BookingNumber, Mode: b.Mode, StartsAt: b.StartsAt, Timezone: b.Timezone, Pax: b.Pax, BoatName: catalog.Pick(snap.BoatName, i18n.Default)})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"counts": counts, "upcoming": list})
}

type table struct {
	header []string
	rows   [][]any
}

func (h *Handler) build(r *http.Request, kind string, from, to time.Time) (table, error) {
	q := dbq.New(h.pool)
	ctx := r.Context()
	switch kind {
	case "bookings":
		rows, err := q.ReportBookings(ctx, dbq.ReportBookingsParams{FromTime: from, ToTime: to})
		if err != nil {
			return table{}, err
		}
		t := table{header: []string{"booking_number", "created_at", "status", "payment_status", "mode", "boat", "route", "starts_at", "pax", "grand_total", "amount_paid", "fees_paid", "amount_refunded", "lead_email"}}
		for _, b := range rows {
			s := bookings.LoadSnapshot(dbq.Booking{Snapshot: b.Snapshot})
			t.rows = append(t.rows, []any{b.BookingNumber, b.CreatedAt.UTC().Format(time.RFC3339), b.Status, b.PaymentStatus, b.Mode, catalog.Pick(s.BoatName, "en"),
				catalog.Pick(s.RouteName, "en"), b.StartsAt.UTC().Format(time.RFC3339), b.Pax, b.GrandTotal, b.AmountPaid, b.FeesPaid, b.AmountRefunded, b.LeadEmail})
		}
		return t, nil
	case "revenue":
		rows, err := q.RevenueByMethod(ctx, dbq.RevenueByMethodParams{FromTime: from, ToTime: to})
		if err != nil {
			return table{}, err
		}
		t := table{header: []string{"method", "payments", "gross_received", "refunded", "net"}}
		for _, m := range rows {
			t.rows = append(t.rows, []any{m.Method, m.Payments, m.Gross, m.Refunded, m.Gross - m.Refunded})
		}
		return t, nil
	case "boats", "routes", "packages":
		rows, err := q.ReportBookings(ctx, dbq.ReportBookingsParams{FromTime: from, ToTime: to})
		if err != nil {
			return table{}, err
		}
		type agg struct {
			name             string
			bookings, pax    int64
			revenue, refunds int64
		}
		m := map[string]*agg{}
		order := []string{}
		for _, b := range rows {
			if b.Status == "EXPIRED" {
				continue
			}
			s := bookings.LoadSnapshot(dbq.Booking{Snapshot: b.Snapshot})
			var key, name string
			switch kind {
			case "boats":
				key, name = b.BoatID.String(), catalog.Pick(s.BoatName, "en")
			case "routes":
				key, name = b.RouteID.String(), catalog.Pick(s.RouteName, "en")
			default:
				if b.PackageID == nil {
					continue
				}
				key, name = b.PackageID.String(), b.PackageID.String()
			}
			a, ok := m[key]
			if !ok {
				a = &agg{name: name}
				m[key] = a
				order = append(order, key)
			}
			a.bookings++
			a.pax += int64(b.Pax)
			a.revenue += b.AmountPaid
			a.refunds += b.AmountRefunded
		}
		t := table{header: []string{"name", "bookings", "pax", "principal_received", "refunded", "net"}}
		for _, k := range order {
			a := m[k]
			t.rows = append(t.rows, []any{a.name, a.bookings, a.pax, a.revenue, a.refunds, a.revenue - a.refunds})
		}
		return t, nil
	case "cancellations":
		rows, err := q.ReportCancellations(ctx, dbq.ReportCancellationsParams{FromTime: from, ToTime: to})
		if err != nil {
			return table{}, err
		}
		t := table{header: []string{"booking_number", "cancelled_at", "cancel_type", "reason", "amount_paid", "forfeited", "refund_total", "refunded_completed"}}
		for _, c := range rows {
			at := ""
			if c.CancelledAt != nil {
				at = c.CancelledAt.UTC().Format(time.RFC3339)
			}
			ct := ""
			if c.CancelType != nil {
				ct = *c.CancelType
			}
			t.rows = append(t.rows, []any{c.BookingNumber, at, ct, c.CancelReason, c.AmountPaid, c.ForfeitedAmount, c.RefundTotal, c.AmountRefunded})
		}
		return t, nil
	}
	return table{}, httpx.NotFound("REPORT_NOT_FOUND")
}

// report exports CSV or XLSX. Revenue is succeeded payments minus completed refunds (PRD 16).
func (h *Handler) report(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	qs := r.URL.Query()
	from, e1 := time.Parse("2006-01-02", qs.Get("from"))
	to, e2 := time.Parse("2006-01-02", qs.Get("to"))
	if e1 != nil || e2 != nil || to.Before(from) || to.Sub(from) > 400*24*time.Hour {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"from": "INVALID_RANGE"}))
		return
	}
	t, err := h.build(r, kind, from, to.AddDate(0, 0, 1))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	name := fmt.Sprintf("%s-%s-%s", kind, qs.Get("from"), qs.Get("to"))
	w.Header().Set("Cache-Control", "private, no-store")
	switch qs.Get("format") {
	case "xlsx":
		f := excelize.NewFile()
		defer f.Close()
		sheet := "Report"
		_ = f.SetSheetName("Sheet1", sheet)
		for i, hdr := range t.header {
			cell, _ := excelize.CoordinatesToCellName(i+1, 1)
			_ = f.SetCellValue(sheet, cell, hdr)
		}
		for ri, row := range t.rows {
			for ci, v := range row {
				cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
				if s, ok := v.(string); ok {
					v = csvSafe(s)
				}
				_ = f.SetCellValue(sheet, cell, v)
			}
		}
		var buf bytes.Buffer
		if err := f.Write(&buf); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.xlsx"`, name))
		_, _ = w.Write(buf.Bytes())
	case "json":
		out := []map[string]any{}
		for _, row := range t.rows {
			m := map[string]any{}
			for i, hdr := range t.header {
				m[hdr] = row[i]
			}
			out = append(out, m)
		}
		httpx.JSON(w, http.StatusOK, out)
	default:
		var buf bytes.Buffer
		cw := csv.NewWriter(&buf)
		_ = cw.Write(t.header)
		for _, row := range t.rows {
			rec := make([]string, len(row))
			for i, v := range row {
				rec[i] = csvSafe(fmt.Sprint(v))
			}
			_ = cw.Write(rec)
		}
		cw.Flush()
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
		_, _ = w.Write(buf.Bytes())
	}
}

func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		if _, err := fmt.Sscan(s, new(float64)); err == nil {
			return s
		}
		return "'" + s
	}
	return s
}
