package bookings

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/modules/catalog"
	"goyacht/internal/platform/db/dbq"
)

type GuestDTO struct {
	FullName string `json:"full_name"`
	Phone    string `json:"phone"`
}

type LeadDTO struct {
	FullName    string `json:"full_name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Nationality string `json:"nationality"`
	IDType      string `json:"id_type"`
	IDLast4     string `json:"id_last4"`
}

type BookingDTO struct {
	ID                uuid.UUID       `json:"id"`
	BookingNumber     string          `json:"booking_number"`
	InvoiceNumber     *string         `json:"invoice_number"`
	Status            string          `json:"status"`
	PaymentStatus     string          `json:"payment_status"`
	Mode              string          `json:"mode"`
	BoatID            uuid.UUID       `json:"boat_id"`
	BoatName          string          `json:"boat_name"`
	RouteName         string          `json:"route_name"`
	PortName          string          `json:"port_name"`
	SlotType          string          `json:"slot_type,omitempty"`
	PackageID         *uuid.UUID      `json:"package_id"`
	StartsAt          time.Time       `json:"starts_at"`
	EndsAt            time.Time       `json:"ends_at"`
	Timezone          string          `json:"timezone"`
	Pax               int32           `json:"pax"`
	Lead              *LeadDTO        `json:"lead,omitempty"`
	Guests            []GuestDTO      `json:"guests,omitempty"`
	SpecialRequest    string          `json:"special_request,omitempty"`
	Lines             []PriceLine     `json:"lines,omitempty"`
	Discount          *DiscountInfo   `json:"discount,omitempty"`
	Taxes             any             `json:"taxes,omitempty"`
	Subtotal          int64           `json:"subtotal"`
	GrandTotal        int64           `json:"grand_total"`
	AmountPaid        int64           `json:"amount_paid"`
	FeesPaid          int64           `json:"fees_paid"`
	AmountRefunded    int64           `json:"amount_refunded"`
	BalanceDue        int64           `json:"balance_due"`
	PaymentScheme     string          `json:"payment_scheme"`
	DepositAmount     int64           `json:"deposit_amount"`
	BalanceDueAt      *time.Time      `json:"balance_due_at"`
	HoldExpiresAt     *time.Time      `json:"hold_expires_at"`
	CancelType        *string         `json:"cancel_type"`
	CancelReason      string          `json:"cancel_reason,omitempty"`
	CancelledAt       *time.Time      `json:"cancelled_at"`
	CreatedAt         time.Time       `json:"created_at"`
	Locale            string          `json:"locale"`
	CancellationTiers json.RawMessage `json:"cancellation_tiers,omitempty"`
	Actions           Actions         `json:"actions"`
}

type Actions struct {
	CanPay            bool `json:"can_pay"`
	CanCancelUnpaid   bool `json:"can_cancel_unpaid"`
	CanRequestCancel  bool `json:"can_request_cancel"`
	CanReschedule     bool `json:"can_request_reschedule"`
	CanDownloadTicket bool `json:"can_download_ticket"`
	CanReview         bool `json:"can_review"`
}

func LoadSnapshot(b dbq.Booking) Snapshot {
	var s Snapshot
	_ = json.Unmarshal(b.Snapshot, &s)
	return s
}

// ToDTO builds the owner/admin view. detailed=false omits personal and price detail for lists.
func ToDTO(b dbq.Booking, locale string, detailed bool, now time.Time) BookingDTO {
	snap := LoadSnapshot(b)
	d := BookingDTO{ID: b.PublicID, BookingNumber: b.BookingNumber, InvoiceNumber: b.InvoiceNumber, Status: b.Status, PaymentStatus: b.PaymentStatus,
		Mode: b.Mode, BoatID: b.BoatID, BoatName: catalog.Pick(snap.BoatName, locale), RouteName: catalog.Pick(snap.RouteName, locale),
		PortName: catalog.Pick(snap.PortName, locale), SlotType: snap.SlotLabel, PackageID: b.PackageID, StartsAt: b.StartsAt, EndsAt: b.EndsAt,
		Timezone: b.Timezone, Pax: b.Pax, Subtotal: b.Subtotal, GrandTotal: b.GrandTotal, AmountPaid: b.AmountPaid, FeesPaid: b.FeesPaid,
		AmountRefunded: b.AmountRefunded, BalanceDue: b.GrandTotal - b.AmountPaid, PaymentScheme: b.PaymentScheme, DepositAmount: b.DepositAmount,
		BalanceDueAt: b.BalanceDueAt, HoldExpiresAt: b.HoldExpiresAt, CancelType: b.CancelType, CancelReason: b.CancelReason,
		CancelledAt: b.CancelledAt, CreatedAt: b.CreatedAt, Locale: b.Locale}
	if Status(b.Status) == StatusCancelled || Status(b.Status) == StatusExpired {
		d.BalanceDue = 0
	}
	if detailed && snap.Quote != nil {
		d.Lines, d.Discount, d.Taxes = snap.Quote.Lines, snap.Quote.Discount, snap.Quote.Taxes
		d.SpecialRequest = b.SpecialRequest
		var cp struct {
			Tiers json.RawMessage `json:"tiers"`
		}
		_ = json.Unmarshal(snap.CancellationPolicy, &cp)
		d.CancellationTiers = cp.Tiers
	}
	st := Status(b.Status)
	unpaidPending := st == StatusPendingPayment && b.HoldExpiresAt != nil && b.HoldExpiresAt.After(now)
	d.Actions = Actions{
		CanPay:            unpaidPending || (st == StatusConfirmed && b.AmountPaid < b.GrandTotal && b.BalanceDueAt != nil && b.BalanceDueAt.After(now)),
		CanCancelUnpaid:   st == StatusPendingPayment && b.AmountPaid == 0,
		CanRequestCancel:  st == StatusConfirmed && b.StartsAt.After(now),
		CanReschedule:     st == StatusConfirmed && b.StartsAt.After(now),
		CanDownloadTicket: (st == StatusConfirmed || st == StatusInProgress || st == StatusCompleted) && b.AmountPaid > 0,
		CanReview:         st == StatusCompleted,
	}
	return d
}

func WithPeople(d *BookingDTO, b dbq.Booking, guests []dbq.BookingGuest, identity *dbq.BookingIdentity) {
	d.Lead = &LeadDTO{FullName: b.LeadFullName, Email: b.LeadEmail, Phone: b.LeadPhone, Nationality: b.LeadNationality}
	if identity != nil {
		d.Lead.IDType = identity.IDType
		d.Lead.IDLast4 = identity.Last4
	}
	d.Guests = make([]GuestDTO, 0, len(guests))
	for _, g := range guests {
		d.Guests = append(d.Guests, GuestDTO{FullName: g.FullName, Phone: g.Phone})
	}
}
