package bookings

import (
	"fmt"
	"net/http"
	"strconv"

	"goyacht/internal/platform/httpx"
)

type Status string

const (
	StatusPendingPayment Status = "PENDING_PAYMENT"
	StatusConfirmed      Status = "CONFIRMED"
	StatusInProgress     Status = "IN_PROGRESS"
	StatusCompleted      Status = "COMPLETED"
	StatusCancelled      Status = "CANCELLED"
	StatusExpired        Status = "EXPIRED"
)

// transitions is the complete set of legal booking moves (PRD 9.2 plus the agreed customer
// self-cancel of unpaid bookings). Anything not listed is rejected.
var transitions = map[Status][]Status{
	StatusPendingPayment: {StatusConfirmed, StatusExpired, StatusCancelled},
	StatusConfirmed:      {StatusInProgress, StatusCancelled},
	StatusInProgress:     {StatusCompleted},
}

func CanTransition(from, to Status) bool {
	for _, s := range transitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

var ErrInvalidTransition = httpx.NewError(http.StatusConflict, "BOOKING_INVALID_TRANSITION", "booking cannot move to that status")

func CheckTransition(from, to Status) error {
	if !CanTransition(from, to) {
		return ErrInvalidTransition.Wrap(fmt.Errorf("%s -> %s", from, to))
	}
	return nil
}

// Live statuses hold inventory and count toward capacity.
var LiveStatuses = []Status{StatusPendingPayment, StatusConfirmed, StatusInProgress, StatusCompleted}

type PaymentStatus string

const (
	PayUnpaid            PaymentStatus = "UNPAID"
	PayDepositPaid       PaymentStatus = "DEPOSIT_PAID"
	PayPaid              PaymentStatus = "PAID"
	PayPartiallyRefunded PaymentStatus = "PARTIALLY_REFUNDED"
	PayRefunded          PaymentStatus = "REFUNDED"
)

// DerivePaymentStatus computes the booking payment status from the money ledger so it can never
// drift from the recorded payments and refunds.
func DerivePaymentStatus(grandTotal, principalPaid, refunded int64) PaymentStatus {
	switch {
	case refunded > 0 && refunded >= principalPaid:
		return PayRefunded
	case refunded > 0:
		return PayPartiallyRefunded
	case principalPaid >= grandTotal && grandTotal > 0:
		return PayPaid
	case principalPaid > 0:
		return PayDepositPaid
	}
	return PayUnpaid
}

const (
	ModeCharter   = "PRIVATE_CHARTER"
	ModeDeparture = "DEPARTURE"

	SlotPrivateArea = "PRIVATE_AREA"
	SlotSeatPool    = "SEAT_POOL"

	CancelCustomer           = "CUSTOMER"
	CancelOperator           = "OPERATOR"
	CancelDepartureCancelled = "DEPARTURE_CANCELLED"
	CancelBalanceOverdue     = "BALANCE_OVERDUE"
	CancelCustomerUnpaid     = "CUSTOMER_UNPAID"
)

var (
	ErrSlotTaken         = httpx.Conflict("BOOKING_SLOT_TAKEN", "the selected time or slot is no longer available")
	ErrCapacityExceeded  = httpx.Conflict("BOOKING_CAPACITY_EXCEEDED", "not enough seats left")
	ErrBookingNotFound   = httpx.NotFound("BOOKING_NOT_FOUND")
	ErrProductNotFound   = httpx.NotFound("PRODUCT_NOT_FOUND")
	ErrBookingClosed     = httpx.Unprocessable("BOOKING_CLOSED", "booking is closed for this schedule")
	ErrLeadTime          = httpx.Unprocessable("BOOKING_LEAD_TIME", "departure is too soon or too far in the future")
	ErrOutsideHours      = httpx.Unprocessable("BOOKING_OUTSIDE_OPERATING_HOURS", "time is outside operating hours")
	ErrPromoInvalid      = httpx.Unprocessable("PROMO_INVALID", "promo code is not valid for this booking")
	ErrPromoExhausted    = httpx.Conflict("PROMO_EXHAUSTED", "promo quota is used up")
	ErrMethodDisabled    = httpx.Unprocessable("PAYMENT_METHOD_UNAVAILABLE", "payment method is not available")
	ErrDepositNotAllowed = httpx.Unprocessable("DEPOSIT_NOT_AVAILABLE", "deposit is not available for this booking")
)

func itoa(i int) string { return strconv.Itoa(i) }
