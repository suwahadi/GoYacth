package bookings

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/settings"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
	"goyacht/internal/platform/validate"
)

type LeadInput struct {
	FullName       string `json:"full_name"`
	Phone          string `json:"phone"`
	Nationality    string `json:"nationality"`
	IDType         string `json:"id_type"`
	IDNumber       string `json:"id_number"`
	SpecialRequest string `json:"special_request"`
}

type GuestInput struct {
	FullName string `json:"full_name"`
	Phone    string `json:"phone"`
}

type Consents struct {
	Terms          bool `json:"terms"`
	Cancellation   bool `json:"cancellation"`
	DepositForfeit bool `json:"deposit_forfeit"`
	DataProcessing bool `json:"data_processing"`
}

type CreateInput struct {
	QuoteInput
	Lead     LeadInput    `json:"lead"`
	Guests   []GuestInput `json:"guests"`
	Consents Consents     `json:"consents"`
}

type Service struct {
	pool    *pgxpool.Pool
	quoter  *Quoter
	cipher  *secure.Cipher
	enqueue jobs.Enqueuer
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, cipher *secure.Cipher, enqueue jobs.Enqueuer) *Service {
	return &Service{pool: pool, quoter: NewQuoter(), cipher: cipher, enqueue: enqueue, now: time.Now}
}

func (s *Service) Quoter() *Quoter { return s.quoter }

func (s *Service) Pool() *pgxpool.Pool { return s.pool }

func (in *CreateInput) normalize() {
	in.Lead.FullName = strings.TrimSpace(in.Lead.FullName)
	in.Lead.Phone = strings.TrimSpace(in.Lead.Phone)
	in.Lead.Nationality = strings.ToUpper(strings.TrimSpace(in.Lead.Nationality))
	in.Lead.IDType = strings.ToUpper(strings.TrimSpace(in.Lead.IDType))
	in.Lead.IDNumber = validate.NormalizeIDNumber(in.Lead.IDNumber)
	in.Lead.SpecialRequest = strings.TrimSpace(in.Lead.SpecialRequest)
	for i := range in.Guests {
		in.Guests[i].FullName = strings.TrimSpace(in.Guests[i].FullName)
		in.Guests[i].Phone = strings.TrimSpace(in.Guests[i].Phone)
	}
}

// validatePeople enforces PRD 8.1–8.4 on the server, independent of any frontend checks.
func (in *CreateInput) validatePeople(requireConsents bool) error {
	f := httpx.FieldErrors{}
	l := in.Lead
	if !validate.Length(l.FullName, 2, 120) {
		f.Add("lead.full_name", "INVALID_LENGTH")
	}
	if !validate.Phone(l.Phone) {
		f.Add("lead.phone", "INVALID_PHONE")
	}
	if !validate.Country(l.Nationality) {
		f.Add("lead.nationality", "INVALID_COUNTRY")
	}
	if field, code := validate.Identity(l.IDType, l.Nationality, l.IDNumber); code != "" {
		f.Add("lead."+field, code)
	}
	if len(l.SpecialRequest) > 1000 {
		f.Add("lead.special_request", "TOO_LONG")
	}
	if len(in.Guests) != in.Pax-1 {
		f.Add("guests", "COUNT_MISMATCH")
	}
	for i, g := range in.Guests {
		if !validate.Length(g.FullName, 2, 120) {
			f.Add("guests."+itoa(i)+".full_name", "INVALID_LENGTH")
		}
		if g.Phone != "" && !validate.Phone(g.Phone) {
			f.Add("guests."+itoa(i)+".phone", "INVALID_PHONE")
		}
	}
	if requireConsents {
		c := in.Consents
		if !c.Terms {
			f.Add("consents.terms", "REQUIRED")
		}
		if !c.Cancellation {
			f.Add("consents.cancellation", "REQUIRED")
		}
		if !c.DataProcessing {
			f.Add("consents.data_processing", "REQUIRED")
		}
		if in.PaymentScheme == "DEPOSIT" && !c.DepositForfeit {
			f.Add("consents.deposit_forfeit", "REQUIRED")
		}
	}
	return f.Err()
}

type Snapshot struct {
	Quote              *Quote             `json:"quote"`
	PaymentPolicy      json.RawMessage    `json:"payment_policy"`
	CancellationPolicy json.RawMessage    `json:"cancellation_policy"`
	Commission         CommissionSnapshot `json:"commission"`
	BoatName           map[string]string  `json:"boat_name"`
	RouteName          map[string]string  `json:"route_name"`
	PortName           map[string]string  `json:"port_name"`
	SlotLabel          string             `json:"slot_label,omitempty"`
}

func (s *Service) snapshot(ctx context.Context, q *dbq.Queries, qu *Quote) (Snapshot, error) {
	r := qu.resolved
	pp, _ := json.Marshal(r.PaymentPolicy)
	cp, err := q.GetCancellationPolicy(ctx, r.CancelPolicyID)
	if err != nil {
		return Snapshot{}, err
	}
	cpj, _ := json.Marshal(map[string]any{"id": cp.ID, "name": cp.Name, "tiers": cp.Tiers, "descriptions": cp.Descriptions})
	snap := Snapshot{Quote: qu, PaymentPolicy: pp, CancellationPolicy: cpj, Commission: qu.Commission,
		BoatName: map[string]string{}, RouteName: map[string]string{}, PortName: map[string]string{}}
	b, err := q.GetBoatAdmin(ctx, r.Boat.ID)
	if err != nil {
		return snap, err
	}
	var bt map[string]struct{ Name string }
	_ = json.Unmarshal(b.Translations, &bt)
	for l, t := range bt {
		snap.BoatName[l] = t.Name
	}
	rt, err := q.GetRouteAdmin(ctx, r.RouteID)
	if err != nil {
		return snap, err
	}
	var rtt map[string]struct{ Name string }
	_ = json.Unmarshal(rt.Translations, &rtt)
	for l, t := range rtt {
		snap.RouteName[l] = t.Name
	}
	ports, err := q.ListPorts(ctx)
	if err != nil {
		return snap, err
	}
	for _, p := range ports {
		if p.ID == rt.DeparturePortID {
			var pn map[string]struct{ Name string }
			_ = json.Unmarshal(p.Translations, &pn)
			for l, t := range pn {
				snap.PortName[l] = t.Name
			}
		}
	}
	if r.Slot != nil {
		snap.SlotLabel = r.Slot.SlotType
	}
	return snap, nil
}

type CreateOptions struct {
	UserID      uuid.UUID
	UserEmail   string
	AdminID     *uuid.UUID
	HoldMinutes int32
}

// Create runs inside the idempotency transaction supplied by the handler. Prices are recomputed
// from server data; anything price-like in the request was already rejected by strict decoding.
func (s *Service) Create(ctx context.Context, tx pgx.Tx, in CreateInput, opts CreateOptions) (dbq.Booking, error) {
	in.normalize()
	in.Locale = i18n.Normalize(in.Locale)
	isAdmin := opts.AdminID != nil
	if !isAdmin && in.PaymentMethod == "" {
		return dbq.Booking{}, httpx.Validation(map[string]string{"payment_method": "REQUIRED"})
	}
	if err := in.validatePeople(!isAdmin); err != nil {
		return dbq.Booking{}, err
	}
	q := dbq.New(tx)
	now := s.now()
	qu, err := s.quoter.Build(ctx, q, in.QuoteInput, isAdmin)
	if err != nil {
		return dbq.Booking{}, err
	}
	r := qu.resolved
	hold := qu.Payment.HoldMinutes
	if opts.HoldMinutes > 0 {
		hold = opts.HoldMinutes
	}
	holdUntil := now.Add(time.Duration(hold) * time.Minute)

	snap, err := s.snapshot(ctx, q, qu)
	if err != nil {
		return dbq.Booking{}, err
	}
	snapJSON, err := json.Marshal(snap)
	if err != nil {
		return dbq.Booking{}, err
	}
	legal, err := settings.Load(ctx, q, "legal", settings.Legal{})
	if err != nil {
		return dbq.Booking{}, err
	}
	consents, _ := json.Marshal(map[string]any{"accepted": in.Consents, "legal_versions": legal, "accepted_at": now.UTC(), "by_admin": isAdmin})

	var slotID *uuid.UUID
	isPrivate := false
	if r.Slot != nil {
		id := r.Slot.ID
		slotID = &id
		isPrivate = r.Slot.SlotType == SlotPrivateArea
	}
	if r.Mode == ModeDeparture {
		if err := reserveDeparture(ctx, q, r, in.Pax, now); err != nil {
			return dbq.Booking{}, err
		}
	}
	var b dbq.Booking
	for attempt := 0; ; attempt++ {
		sp, err := tx.Begin(ctx)
		if err != nil {
			return dbq.Booking{}, err
		}
		b, err = dbq.New(sp).InsertBooking(ctx, dbq.InsertBookingParams{
			BookingNumber: secure.BookingNumber(), UserID: opts.UserID, Mode: r.Mode, PackageID: r.PackageID, BoatID: r.Boat.ID,
			RouteID: r.RouteID, DepartureID: r.DepartureID, DepartureSlotID: slotID, IsPrivateSlot: isPrivate,
			StartsAt: r.StartsAt, EndsAt: r.EndsAt, Timezone: r.Timezone, Pax: int32(in.Pax), PaymentScheme: qu.Payment.Scheme,
			Subtotal: qu.Subtotal, GrandTotal: qu.GrandTotal, DepositAmount: qu.Payment.DepositAmount, HoldExpiresAt: &holdUntil,
			BalanceDueAt: qu.Payment.BalanceDueAt, Snapshot: snapJSON, Consents: consents, LeadFullName: in.Lead.FullName,
			LeadEmail: opts.UserEmail, LeadPhone: in.Lead.Phone, LeadNationality: in.Lead.Nationality, SpecialRequest: in.Lead.SpecialRequest,
			Locale: in.Locale, VerifyToken: secure.RandomToken(16), CreatedByAdmin: opts.AdminID,
		})
		if err == nil {
			if err := sp.Commit(ctx); err != nil {
				return dbq.Booking{}, err
			}
			break
		}
		_ = sp.Rollback(ctx)
		switch db.UniqueConstraint(err) {
		case "bookings_private_slot_unique_idx":
			return dbq.Booking{}, ErrSlotTaken
		case "bookings_booking_number_key":
			if attempt < 5 {
				continue
			}
		}
		return dbq.Booking{}, err
	}

	if r.Mode == ModeCharter {
		if err := reserveCharter(ctx, tx, q, b.ID, r, holdUntil, now); err != nil {
			return dbq.Booking{}, err
		}
	}
	if qu.Discount != nil {
		n, err := q.ReservePromotionQuota(ctx, qu.Discount.PromotionID)
		if err != nil {
			return dbq.Booking{}, err
		}
		if n == 0 {
			return dbq.Booking{}, ErrPromoExhausted
		}
		if err := q.InsertPromotionRedemption(ctx, dbq.InsertPromotionRedemptionParams{PromotionID: qu.Discount.PromotionID, BookingID: b.ID}); err != nil {
			return dbq.Booking{}, err
		}
	}
	for i, g := range in.Guests {
		if err := q.InsertBookingGuest(ctx, dbq.InsertBookingGuestParams{BookingID: b.ID, SortOrder: int32(i + 1), FullName: g.FullName, Phone: g.Phone}); err != nil {
			return dbq.Booking{}, err
		}
	}
	ct, keyID, err := s.cipher.Encrypt([]byte(in.Lead.IDNumber), b.ID[:])
	if err != nil {
		return dbq.Booking{}, err
	}
	if err := q.InsertBookingIdentity(ctx, dbq.InsertBookingIdentityParams{BookingID: b.ID, IDType: in.Lead.IDType, Ciphertext: ct, KeyID: &keyID, Last4: last4(in.Lead.IDNumber)}); err != nil {
		return dbq.Booking{}, err
	}
	if isAdmin {
		if err := audit.Record(ctx, q, audit.Entry{ActorID: opts.AdminID, Action: "booking.created_manual", EntityType: "booking", EntityID: b.ID.String(),
			After: map[string]any{"booking_number": b.BookingNumber, "user_id": opts.UserID, "grand_total": b.GrandTotal}}); err != nil {
			return dbq.Booking{}, err
		}
	}
	bid := b.ID
	if err := s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: "booking_created", BookingID: &bid, DedupeKey: "booking_created:" + b.ID.String(), Audience: jobs.AudienceCustomer}); err != nil {
		return dbq.Booking{}, err
	}
	if err := s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: "admin_booking_created", BookingID: &bid, DedupeKey: "admin_booking_created:" + b.ID.String(), Audience: jobs.AudienceAdmin}); err != nil {
		return dbq.Booking{}, err
	}
	return b, nil
}

func last4(s string) string {
	if len(s) <= 4 {
		return s
	}
	return s[len(s)-4:]
}

// CancelUnpaid lets a customer abandon their own unpaid booking; the hold is released now.
func (s *Service) CancelUnpaid(ctx context.Context, userID uuid.UUID, publicID uuid.UUID) error {
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		b, err := q.GetBookingByPublicID(ctx, publicID)
		if err != nil || b.UserID != userID {
			return ErrBookingNotFound
		}
		b, err = q.LockBooking(ctx, b.ID)
		if err != nil {
			return err
		}
		if Status(b.Status) != StatusPendingPayment {
			return ErrInvalidTransition
		}
		if b.AmountPaid > 0 {
			return ErrInvalidTransition
		}
		if _, err := q.CancelBookingRow(ctx, dbq.CancelBookingRowParams{ID: b.ID, CancelType: strPtr(CancelCustomerUnpaid), CancelReason: "cancelled by customer before payment"}); err != nil {
			return err
		}
		if err := ReleaseHolds(ctx, q, b.ID); err != nil {
			return err
		}
		return cancelOpenPayments(ctx, q, b.ID)
	})
}

func cancelOpenPayments(ctx context.Context, q *dbq.Queries, bookingID uuid.UUID) error {
	_, err := q.CancelPendingPayments(ctx, bookingID)
	return err
}

func strPtr(s string) *string { return &s }
