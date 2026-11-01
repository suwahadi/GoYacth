package tickets

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/notifications"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/secure"
)

type Handler struct {
	pool   *pgxpool.Pool
	msgs   *i18n.Messages
	cipher *secure.Cipher
	appURL string
}

func NewHandler(pool *pgxpool.Pool, msgs *i18n.Messages, cipher *secure.Cipher, appURL string) *Handler {
	return &Handler{pool: pool, msgs: msgs, cipher: cipher, appURL: strings.TrimRight(appURL, "/")}
}

func (h *Handler) CustomerRoutes(r chi.Router) {
	r.Get("/bookings/{id}/ticket.pdf", h.customerTicket)
	r.Get("/bookings/{id}/invoice.pdf", h.customerInvoice)
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/bookings/{id}/ticket.pdf", h.adminTicket)
	r.Get("/bookings/{id}/invoice.pdf", h.adminInvoice)
	r.Get("/manifests/departure/{id}", h.departureManifest)
	r.Get("/manifests/booking/{id}", h.bookingManifest)
}

var ErrTicketUnavailable = httpx.Conflict("TICKET_NOT_AVAILABLE", "the ticket is issued after the first payment")

func ticketAllowed(b dbq.Booking) bool {
	st := bookings.Status(b.Status)
	return b.AmountPaid > 0 && !b.VerifyTokenRevoked && (st == bookings.StatusConfirmed || st == bookings.StatusInProgress || st == bookings.StatusCompleted)
}

// Ticket renders the e-ticket on demand from current data; it is never stored, so it always
// reflects the booking's present status and balance (PRD 11.3).
func (h *Handler) Ticket(ctx context.Context, q *dbq.Queries, b dbq.Booking, locale string) ([]byte, error) {
	t := func(k string) string { return h.msgs.T(locale, "pdf.ticket."+k, nil) }
	snap := bookings.LoadSnapshot(b)
	guests, err := q.ListBookingGuests(ctx, []uuid.UUID{b.ID})
	if err != nil {
		return nil, err
	}
	d, err := newDoc(false)
	if err != nil {
		return nil, err
	}
	if err := d.text(margin, "GoYacht", 22, true, brand); err != nil {
		return nil, err
	}
	if err := d.textRight(d.width()-margin, t("title"), 16, true); err != nil {
		return nil, err
	}
	d.y += 34
	d.rule()
	d.y += 14
	verifyURL := h.appURL + "/verify/" + b.VerifyToken
	img, err := qrImage(verifyURL, 300)
	if err != nil {
		return nil, err
	}
	qrSize := 130.0
	if err := d.pdf.ImageFrom(img, d.width()-margin-qrSize, d.y, &rect{W: qrSize, H: qrSize}); err != nil {
		return nil, err
	}
	rows := [][2]string{
		{t("booking_number"), b.BookingNumber},
		{t("status"), b.Status},
		{t("boat"), catalog.Pick(snap.BoatName, locale)},
		{t("route"), catalog.Pick(snap.RouteName, locale)},
		{t("port"), catalog.Pick(snap.PortName, locale)},
		{t("departure"), notifications.FormatLocal(b.StartsAt, b.Timezone)},
		{t("return"), notifications.FormatLocal(b.EndsAt, b.Timezone)},
		{t("pax"), fmt.Sprintf("%d", b.Pax)},
		{t("lead"), b.LeadFullName},
	}
	for _, r := range rows {
		if err := d.kv(r[0], r[1]); err != nil {
			return nil, err
		}
	}
	if d.y < 40+34+14+qrSize+20 {
		d.y = 40 + 34 + 14 + qrSize + 20
	}
	d.y += 6
	if len(guests) > 0 {
		if err := d.text(margin, t("guests"), 12, true, brand); err != nil {
			return nil, err
		}
		d.y += 20
		for i, g := range guests {
			d.ensure(16)
			if err := d.text(margin, fmt.Sprintf("%d. %s", i+2, g.FullName), 10, false, ink); err != nil {
				return nil, err
			}
			d.y += 16
		}
		d.y += 8
	}
	d.ensure(110)
	d.rule()
	d.y += 14
	if err := d.text(margin, t("payment"), 12, true, brand); err != nil {
		return nil, err
	}
	d.y += 20
	if err := d.kv(t("total"), notifications.FormatIDR(b.GrandTotal)); err != nil {
		return nil, err
	}
	if err := d.kv(t("paid"), notifications.FormatIDR(b.AmountPaid)); err != nil {
		return nil, err
	}
	if b.AmountPaid < b.GrandTotal {
		if err := d.kv(t("balance"), notifications.FormatIDR(b.GrandTotal-b.AmountPaid)); err != nil {
			return nil, err
		}
		if b.BalanceDueAt != nil {
			if err := d.kv(t("balance_deadline"), notifications.FormatLocal(*b.BalanceDueAt, b.Timezone)); err != nil {
				return nil, err
			}
		}
	}
	d.y += 12
	if err := d.wrapped(margin, d.width()-2*margin, t("scan")+" "+t("arrive"), 9); err != nil {
		return nil, err
	}
	return d.bytes()
}

// Invoice renders a plain PDF invoice numbered INV/YYYY/NNNNNN (no e-Faktur in v1).
func (h *Handler) Invoice(ctx context.Context, q *dbq.Queries, b dbq.Booking, locale string) ([]byte, error) {
	t := func(k string) string { return h.msgs.T(locale, "pdf.invoice."+k, nil) }
	snap := bookings.LoadSnapshot(b)
	d, err := newDoc(false)
	if err != nil {
		return nil, err
	}
	right := d.width() - margin
	if err := d.text(margin, "GoYacht", 22, true, brand); err != nil {
		return nil, err
	}
	if err := d.textRight(right, t("title"), 16, true); err != nil {
		return nil, err
	}
	d.y += 34
	d.rule()
	d.y += 14
	issued := b.CreatedAt
	pays, err := q.ListBookingPayments(ctx, b.ID)
	if err != nil {
		return nil, err
	}
	for _, p := range pays {
		if p.Status == "SUCCEEDED" && p.PaidAt != nil {
			issued = *p.PaidAt
			break
		}
	}
	for _, r := range [][2]string{
		{t("number"), deref(b.InvoiceNumber)},
		{t("date"), notifications.FormatLocal(issued, b.Timezone)},
		{t("bill_to"), b.LeadFullName + " <" + b.LeadEmail + ">"},
	} {
		if err := d.kv(r[0], r[1]); err != nil {
			return nil, err
		}
	}
	d.y += 10
	d.rule()
	d.y += 10
	line := func(label, amount string, bold bool) error {
		d.ensure(18)
		if err := d.text(margin, label, 10, bold, ink); err != nil {
			return err
		}
		if err := d.textRight(right, amount, 10, bold); err != nil {
			return err
		}
		d.y += 18
		return nil
	}
	if err := line(t("description"), t("amount"), true); err != nil {
		return nil, err
	}
	desc := fmt.Sprintf("%s · %s · %s (%s)", catalog.Pick(snap.BoatName, locale), catalog.Pick(snap.RouteName, locale),
		notifications.FormatLocal(b.StartsAt, b.Timezone), b.BookingNumber)
	if snap.Quote != nil {
		for _, l := range snap.Quote.Lines {
			label := desc
			if l.Quantity > 1 {
				label = fmt.Sprintf("%s × %d", desc, l.Quantity)
			}
			if err := line(label, notifications.FormatIDR(l.Amount), false); err != nil {
				return nil, err
			}
		}
		if snap.Quote.Discount != nil {
			if err := line(t("discount")+" "+snap.Quote.Discount.Name, notifications.FormatIDR(-snap.Quote.Discount.Amount), false); err != nil {
				return nil, err
			}
		}
		if err := line(t("subtotal"), notifications.FormatIDR(b.Subtotal), true); err != nil {
			return nil, err
		}
		for _, tx := range snap.Quote.Taxes {
			if err := line(fmt.Sprintf("%s (%d.%02d%%)", tx.Name, tx.BasisPoints/100, tx.BasisPoints%100), notifications.FormatIDR(tx.Amount), false); err != nil {
				return nil, err
			}
		}
	}
	if err := line(t("total"), notifications.FormatIDR(b.GrandTotal), true); err != nil {
		return nil, err
	}
	if b.FeesPaid > 0 {
		if err := line(t("fees"), notifications.FormatIDR(b.FeesPaid), false); err != nil {
			return nil, err
		}
	}
	if err := line(t("paid"), notifications.FormatIDR(b.AmountPaid+b.FeesPaid), false); err != nil {
		return nil, err
	}
	if b.AmountRefunded > 0 {
		if err := line(t("refunded"), notifications.FormatIDR(b.AmountRefunded), false); err != nil {
			return nil, err
		}
	}
	if st := bookings.Status(b.Status); st != bookings.StatusCancelled && st != bookings.StatusExpired && b.AmountPaid < b.GrandTotal {
		if err := line(t("balance"), notifications.FormatIDR(b.GrandTotal-b.AmountPaid), true); err != nil {
			return nil, err
		}
	}
	return d.bytes()
}

func deref(s *string) string {
	if s == nil {
		return "-"
	}
	return *s
}

func writePDF(w http.ResponseWriter, name string, data []byte) {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, name))
	_, _ = w.Write(data)
}

func (h *Handler) customerTicket(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !ticketAllowed(b) {
		httpx.WriteError(w, r, ErrTicketUnavailable)
		return
	}
	data, err := h.Ticket(r.Context(), q, b, i18n.Normalize(r.URL.Query().Get("locale")))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	writePDF(w, "ticket-"+b.BookingNumber+".pdf", data)
}

func (h *Handler) customerInvoice(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if b.InvoiceNumber == nil {
		httpx.WriteError(w, r, httpx.Conflict("INVOICE_NOT_AVAILABLE", "invoice is issued after the first payment"))
		return
	}
	data, err := h.Invoice(r.Context(), q, b, i18n.Normalize(r.URL.Query().Get("locale")))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	writePDF(w, "invoice-"+b.BookingNumber+".pdf", data)
}

func (h *Handler) adminBooking(r *http.Request, q *dbq.Queries) (dbq.Booking, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return dbq.Booking{}, bookings.ErrBookingNotFound
	}
	b, err := q.GetBookingByPublicID(r.Context(), id)
	if err != nil {
		return dbq.Booking{}, bookings.ErrBookingNotFound
	}
	return b, nil
}

func (h *Handler) adminTicket(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := h.adminBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !ticketAllowed(b) {
		httpx.WriteError(w, r, ErrTicketUnavailable)
		return
	}
	data, err := h.Ticket(r.Context(), q, b, i18n.Default)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	writePDF(w, "ticket-"+b.BookingNumber+".pdf", data)
}

func (h *Handler) adminInvoice(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := h.adminBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	data, err := h.Invoice(r.Context(), q, b, i18n.Default)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	writePDF(w, "invoice-"+b.BookingNumber+".pdf", data)
}

type manifestRow struct {
	Booking     string
	Name        string
	Nationality string
	IDType      string
	IDNumber    string
	Phone       string
}

// manifestRows lists paid passengers. Identity numbers are masked to their last four characters
// unless reveal is set, and every reveal is written to the audit log.
func (h *Handler) manifestRows(ctx context.Context, q *dbq.Queries, list []dbq.Booking, reveal bool) ([]manifestRow, error) {
	ids := make([]uuid.UUID, 0, len(list))
	for _, b := range list {
		ids = append(ids, b.ID)
	}
	guests, err := q.ListBookingGuests(ctx, ids)
	if err != nil {
		return nil, err
	}
	idents, err := q.ListBookingIdentities(ctx, ids)
	if err != nil {
		return nil, err
	}
	identByBooking := map[uuid.UUID]dbq.BookingIdentity{}
	for _, i := range idents {
		identByBooking[i.BookingID] = i
	}
	out := []manifestRow{}
	for _, b := range list {
		ident := identByBooking[b.ID]
		num := ""
		if ident.Last4 != "" {
			num = "****" + ident.Last4
		}
		if ident.PurgedAt != nil {
			num = "(purged)"
		}
		if reveal && ident.Ciphertext != nil && ident.KeyID != nil {
			plain, err := h.cipher.Decrypt(ident.Ciphertext, *ident.KeyID, b.ID[:])
			if err != nil {
				return nil, err
			}
			num = string(plain)
		}
		out = append(out, manifestRow{Booking: b.BookingNumber, Name: b.LeadFullName, Nationality: b.LeadNationality, IDType: ident.IDType, IDNumber: num, Phone: b.LeadPhone})
		for _, g := range guests {
			if g.BookingID == b.ID {
				out = append(out, manifestRow{Booking: b.BookingNumber, Name: g.FullName, Phone: g.Phone})
			}
		}
	}
	return out, nil
}

func (h *Handler) departureManifest(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("DEPARTURE_NOT_FOUND"))
		return
	}
	q := dbq.New(h.pool)
	dep, err := q.GetDeparture(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("DEPARTURE_NOT_FOUND"))
		return
	}
	rows, err := q.ListBookingsAdmin(r.Context(), dbq.ListBookingsAdminParams{Limit: 1000, DepartureID: &id})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	list := []dbq.Booking{}
	for _, b := range rows {
		if st := bookings.Status(b.Status); st == bookings.StatusConfirmed || st == bookings.StatusInProgress || st == bookings.StatusCompleted {
			list = append(list, b)
		}
	}
	h.writeManifest(w, r, "departure", id.String(), dep.DepartsAt, list)
}

func (h *Handler) bookingManifest(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := h.adminBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	h.writeManifest(w, r, "booking", b.ID.String(), b.StartsAt, []dbq.Booking{b})
}

func (h *Handler) writeManifest(w http.ResponseWriter, r *http.Request, entity, entityID string, startsAt time.Time, list []dbq.Booking) {
	reveal := r.URL.Query().Get("reveal") == "true"
	format := r.URL.Query().Get("format")
	var rows []manifestRow
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		rows, err = h.manifestRows(r.Context(), q, list, reveal)
		if err != nil {
			return err
		}
		if reveal {
			return audit.Record(r.Context(), q, audit.Entry{ActorID: auth.UserIDPtr(auth.FromContext(r.Context())), Action: "manifest.identity_revealed", EntityType: entity, EntityID: entityID})
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	t := func(k string) string { return h.msgs.T(i18n.Default, "pdf.manifest."+k, nil) }
	name := fmt.Sprintf("manifest-%s", startsAt.Format("20060102-1504"))
	w.Header().Set("Cache-Control", "private, no-store")
	if format == "csv" {
		var buf bytes.Buffer
		cw := csv.NewWriter(&buf)
		_ = cw.Write([]string{t("no"), t("booking"), t("name"), t("nationality"), t("id_type"), t("id_number"), t("phone")})
		for i, row := range rows {
			_ = cw.Write([]string{fmt.Sprintf("%d", i+1), row.Booking, csvSafe(row.Name), row.Nationality, row.IDType, row.IDNumber, row.Phone})
		}
		cw.Flush()
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
		_, _ = w.Write(buf.Bytes())
		return
	}
	d, err := newDoc(true)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	_ = d.text(margin, t("title"), 16, true, brand)
	_ = d.textRight(d.width()-margin, startsAt.UTC().Format("2006-01-02 15:04 UTC"), 10, false)
	d.y += 28
	cols := []float64{margin, margin + 30, margin + 140, margin + 340, margin + 430, margin + 520, margin + 650}
	header := []string{t("no"), t("booking"), t("name"), t("nationality"), t("id_type"), t("id_number"), t("phone")}
	for i, hdr := range header {
		_ = d.text(cols[i], hdr, 9, true, muted)
	}
	d.y += 16
	d.rule()
	d.y += 6
	for i, row := range rows {
		d.ensure(16)
		vals := []string{fmt.Sprintf("%d", i+1), row.Booking, row.Name, row.Nationality, row.IDType, row.IDNumber, row.Phone}
		for c, v := range vals {
			_ = d.text(cols[c], truncateRunes(v, 34), 9, false, ink)
		}
		d.y += 16
	}
	data, err := d.bytes()
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	writePDF(w, name+".pdf", data)
}

// csvSafe prevents spreadsheet formula injection from user-entered names.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
