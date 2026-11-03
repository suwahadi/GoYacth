package notifications

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	htmltemplate "html/template"
	"net/url"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"goyacht/internal/integrations/smtp"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
	"goyacht/templates"
)

type Service struct {
	pool     *pgxpool.Pool
	sender   smtp.Sender
	msgs     *i18n.Messages
	appURL   string
	adminTo  []string
	siteName string
}

func NewService(pool *pgxpool.Pool, sender smtp.Sender, msgs *i18n.Messages, appURL string, adminTo []string) *Service {
	return &Service{pool: pool, sender: sender, msgs: msgs, appURL: strings.TrimRight(appURL, "/"), adminTo: adminTo, siteName: "GoYacht"}
}

var (
	htmlLayout = htmltemplate.Must(htmltemplate.ParseFS(templates.FS, "email/layout.html"))
	textLayout = texttemplate.Must(texttemplate.ParseFS(templates.FS, "email/layout.txt"))
)

type row struct{ Label, Value string }

type view struct {
	Locale, Subject, Site, Greeting, Body, ActionURL, ActionLabel, Signoff, Footer string
	Rows                                                                           []row
}

// message renders both bodies; callers add the recipient and Message-ID.
func (v view) message() (smtp.Message, error) {
	var html, text bytes.Buffer
	if err := htmlLayout.Execute(&html, v); err != nil {
		return smtp.Message{}, err
	}
	if err := textLayout.Execute(&text, v); err != nil {
		return smtp.Message{}, err
	}
	return smtp.Message{Subject: v.Subject, HTML: html.String(), Text: text.String()}, nil
}

// Send renders and delivers one notification. The notification_logs row keyed by the job's
// dedupe key is claimed before sending and marked SENT afterwards, so a retried or duplicated job
// skips anything already delivered. The Message-ID is derived from the same key, letting mail
// providers drop the rare duplicate if a worker dies between sending and marking.
func (s *Service) Send(ctx context.Context, n jobs.Notify) error {
	q := dbq.New(s.pool)
	var b *dbq.Booking
	if n.BookingID != nil {
		bk, err := q.GetBooking(ctx, *n.BookingID)
		if err != nil {
			if db.IsNoRows(err) {
				return river.JobCancel(err)
			}
			return err
		}
		b = &bk
	}
	recipients, locale, userID, err := s.recipients(ctx, q, n, b)
	if err != nil {
		return err
	}
	for i, to := range recipients {
		key := n.DedupeKey
		if i > 0 {
			key = fmt.Sprintf("%s#%d", n.DedupeKey, i)
		}
		if err := s.sendOne(ctx, q, n, b, to, locale, userID, key); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) recipients(ctx context.Context, q *dbq.Queries, n jobs.Notify, b *dbq.Booking) ([]string, string, *uuid.UUID, error) {
	if n.Audience == jobs.AudienceAdmin {
		emails, err := q.ListActiveAdminEmails(ctx)
		if err != nil {
			return nil, "", nil, err
		}
		seen := map[string]bool{}
		out := []string{}
		for _, e := range append(s.adminTo, emails...) {
			e = strings.ToLower(strings.TrimSpace(e))
			if e != "" && !seen[e] {
				seen[e] = true
				out = append(out, e)
			}
		}
		return out, "en", nil, nil
	}
	if b == nil {
		return nil, "", nil, river.JobCancel(errors.New("customer notification without booking"))
	}
	u, err := q.GetUserByID(ctx, b.UserID)
	if err != nil {
		return nil, "", nil, err
	}
	if u.Status == "ANONYMIZED" {
		return nil, "", nil, nil
	}
	uid := u.ID
	return []string{b.LeadEmail}, i18n.Normalize(b.Locale), &uid, nil
}

func (s *Service) sendOne(ctx context.Context, q *dbq.Queries, n jobs.Notify, b *dbq.Booking, to, locale string, userID *uuid.UUID, key string) error {
	log, err := q.ClaimNotification(ctx, dbq.ClaimNotificationParams{Kind: n.Template, DedupeKey: key, BookingID: n.BookingID, UserID: userID, Recipient: to, Locale: locale})
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	msg, err := s.render(ctx, q, n, b, locale)
	if err != nil {
		return err
	}
	msg.To = to
	msg.MessageID = fmt.Sprintf("<%s@goyacht>", strings.NewReplacer(":", ".", "#", ".").Replace(key))
	if err := s.sender.Send(ctx, msg); err != nil {
		_ = q.MarkNotificationFailed(ctx, dbq.MarkNotificationFailedParams{ID: log.ID, LastError: truncate(err.Error(), 500)})
		return err
	}
	return q.MarkNotificationSent(ctx, log.ID)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func FormatIDR(v int64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := fmt.Sprintf("%d", v)
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	if neg {
		return "-IDR " + string(out)
	}
	return "IDR " + string(out)
}

func ZoneLabel(tz string) string {
	switch tz {
	case "Asia/Jakarta", "Asia/Pontianak":
		return "WIB"
	case "Asia/Makassar":
		return "WITA"
	case "Asia/Jayapura":
		return "WIT"
	}
	return tz
}

func FormatLocal(t time.Time, tz string) string {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2 Jan 2006 15:04") + " " + ZoneLabel(tz)
}

func (s *Service) bookingURL(b *dbq.Booking, locale string) string {
	prefix := ""
	if locale != i18n.Default {
		prefix = "/" + locale
	}
	return s.appURL + prefix + "/account/bookings/" + b.PublicID.String()
}

func (s *Service) render(ctx context.Context, q *dbq.Queries, n jobs.Notify, b *dbq.Booking, locale string) (smtp.Message, error) {
	t := func(key string, vars map[string]string) string { return s.msgs.T(locale, "email."+key, vars) }
	vars := map[string]string{}
	v := view{Locale: locale, Site: s.siteName, Signoff: t("common.signoff", nil), Footer: t("common.footer", nil)}
	if b != nil {
		snap := bookings.LoadSnapshot(*b)
		vars["number"] = b.BookingNumber
		vars["boat"] = catalog.Pick(snap.BoatName, locale)
		vars["departure"] = FormatLocal(b.StartsAt, b.Timezone)
		vars["port"] = catalog.Pick(snap.PortName, locale)
		vars["name"] = b.LeadFullName
		vars["status"] = b.Status
		vars["reason"] = b.CancelReason
		if b.HoldExpiresAt != nil {
			vars["deadline"] = FormatLocal(*b.HoldExpiresAt, b.Timezone)
		}
		if n.Template == "balance_reminder" && b.BalanceDueAt != nil {
			vars["deadline"] = FormatLocal(*b.BalanceDueAt, b.Timezone)
			vars["amount"] = FormatIDR(b.GrandTotal - b.AmountPaid)
		}
		v.Rows = []row{
			{t("common.booking_number", nil), b.BookingNumber},
			{t("common.boat", nil), vars["boat"]},
			{t("common.route", nil), catalog.Pick(snap.RouteName, locale)},
			{t("common.departure", nil), vars["departure"]},
			{t("common.guests", nil), fmt.Sprintf("%d", b.Pax)},
			{t("common.total", nil), FormatIDR(b.GrandTotal)},
			{t("common.paid", nil), FormatIDR(b.AmountPaid)},
		}
		if b.AmountPaid > 0 && b.AmountPaid < b.GrandTotal && b.BalanceDueAt != nil {
			v.Rows = append(v.Rows, row{t("common.balance", nil), FormatIDR(b.GrandTotal - b.AmountPaid)}, row{t("common.balance_deadline", nil), FormatLocal(*b.BalanceDueAt, b.Timezone)})
		}
		if n.Audience == jobs.AudienceCustomer {
			v.ActionURL, v.ActionLabel = s.bookingURL(b, locale), t("common.view_booking", nil)
		} else {
			v.ActionURL, v.ActionLabel = s.appURL+"/admin/bookings/"+b.PublicID.String(), "Open in admin"
		}
	}
	switch n.Template {
	case "payment_succeeded", "admin_payment_received", "admin_exception":
		if b != nil {
			pays, err := q.ListBookingPayments(ctx, b.ID)
			if err != nil {
				return smtp.Message{}, err
			}
			for i := len(pays) - 1; i >= 0; i-- {
				if pays[i].Status == "SUCCEEDED" {
					vars["amount"] = FormatIDR(pays[i].GrossAmount)
					break
				}
			}
		}
	case "refund":
		if n.RefundID != nil {
			rf, err := q.GetRefund(ctx, *n.RefundID)
			if err != nil {
				return smtp.Message{}, err
			}
			vars["amount"], vars["status"] = FormatIDR(rf.Amount), rf.Status
		}
	case "admin_request":
		vars["type"] = "change"
		if b != nil {
			reqs, err := q.ListBookingRequests(ctx, b.ID)
			if err == nil && len(reqs) > 0 {
				vars["type"] = strings.ToLower(reqs[len(reqs)-1].Type)
			}
		}
	case "welcome":
	}
	if v.Greeting == "" {
		name := vars["name"]
		if name == "" {
			name = "there"
		}
		v.Greeting = t("common.greeting", map[string]string{"name": name})
	}
	v.Subject = t(n.Template+".subject", vars)
	v.Body = t(n.Template+".body", vars)
	return v.message()
}

// SendWelcome greets a newly registered customer.
func (s *Service) SendWelcome(ctx context.Context, userID uuid.UUID) error {
	q := dbq.New(s.pool)
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return river.JobCancel(err)
	}
	key := "welcome:" + u.ID.String()
	log, err := q.ClaimNotification(ctx, dbq.ClaimNotificationParams{Kind: "welcome", DedupeKey: key, UserID: &u.ID, Recipient: u.Email, Locale: u.PreferredLocale})
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	t := func(k string) string {
		return s.msgs.T(u.PreferredLocale, "email."+k, map[string]string{"name": u.FullName})
	}
	v := view{Locale: u.PreferredLocale, Site: s.siteName, Subject: t("welcome.subject"), Greeting: t("common.greeting"), Body: t("welcome.body"),
		ActionURL: s.appURL, ActionLabel: "GoYacht", Signoff: t("common.signoff"), Footer: t("common.footer")}
	msg, err := v.message()
	if err != nil {
		return err
	}
	msg.To, msg.MessageID = u.Email, "<"+strings.ReplaceAll(key, ":", ".")+"@goyacht>"
	if err := s.sender.Send(ctx, msg); err != nil {
		_ = q.MarkNotificationFailed(ctx, dbq.MarkNotificationFailedParams{ID: log.ID, LastError: truncate(err.Error(), 500)})
		return err
	}
	return q.MarkNotificationSent(ctx, log.ID)
}

// SendAuthEmail sends the link that confirms an address or resets a password, in the customer's
// language.
func (s *Service) SendAuthEmail(ctx context.Context, a jobs.SendAuthEmail) error {
	q := dbq.New(s.pool)
	u, err := q.GetUserByID(ctx, a.UserID)
	if err != nil {
		return river.JobCancel(err)
	}
	kind, path := a.Template, "/reset-password"
	if kind == "verify_email" {
		path = "/verify-email"
	}
	key := kind + ":" + secure.HexSHA256([]byte(a.Token))[:24]
	log, err := q.ClaimNotification(ctx, dbq.ClaimNotificationParams{Kind: kind, DedupeKey: key, UserID: &u.ID, Recipient: u.Email, Locale: u.PreferredLocale})
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	prefix := ""
	if u.PreferredLocale != i18n.Default {
		prefix = "/" + u.PreferredLocale
	}
	link := url.Values{"token": {a.Token}}
	if a.ReturnTo != "" && a.ReturnTo != "/" {
		link.Set("return_to", a.ReturnTo)
	}
	name := u.FullName
	if name == "" {
		name = "there"
	}
	t := func(k string) string {
		return s.msgs.T(u.PreferredLocale, "email."+k, map[string]string{"name": name})
	}
	v := view{Locale: u.PreferredLocale, Site: s.siteName, Subject: t(kind + ".subject"), Greeting: t("common.greeting"), Body: t(kind + ".body"),
		ActionURL: s.appURL + prefix + path + "?" + link.Encode(), ActionLabel: t(kind + ".action"), Signoff: t("common.signoff"), Footer: t("common.footer")}
	msg, err := v.message()
	if err != nil {
		return err
	}
	msg.To, msg.MessageID = u.Email, "<"+strings.ReplaceAll(key, ":", ".")+"@goyacht>"
	if err := s.sender.Send(ctx, msg); err != nil {
		_ = q.MarkNotificationFailed(ctx, dbq.MarkNotificationFailedParams{ID: log.ID, LastError: truncate(err.Error(), 500)})
		return err
	}
	return q.MarkNotificationSent(ctx, log.ID)
}
