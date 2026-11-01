package midtrans

import (
	"bytes"
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Item struct {
	ID       string `json:"id"`
	Price    int64  `json:"price"`
	Quantity int    `json:"quantity"`
	Name     string `json:"name"`
}

type Customer struct {
	FirstName string `json:"first_name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
}

type SnapRequest struct {
	OrderID       string
	GrossAmount   int64
	Items         []Item
	Customer      Customer
	Method        string
	ExpiryMinutes int
	FinishURL     string
}

type SnapResponse struct {
	Token       string `json:"token"`
	RedirectURL string `json:"redirect_url"`
}

type VANumber struct {
	Bank     string `json:"bank"`
	VANumber string `json:"va_number"`
}

// Status is the authoritative transaction state from the Status API.
type Status struct {
	OrderID           string     `json:"order_id"`
	TransactionID     string     `json:"transaction_id"`
	TransactionStatus string     `json:"transaction_status"`
	FraudStatus       string     `json:"fraud_status"`
	StatusCode        string     `json:"status_code"`
	GrossAmount       string     `json:"gross_amount"`
	Currency          string     `json:"currency"`
	PaymentType       string     `json:"payment_type"`
	MerchantID        string     `json:"merchant_id"`
	VANumbers         []VANumber `json:"va_numbers"`
	PermataVANumber   string     `json:"permata_va_number"`
	BillKey           string     `json:"bill_key"`
	BillerCode        string     `json:"biller_code"`
	SettlementTime    string     `json:"settlement_time"`
}

type Gateway interface {
	CreateSnap(ctx context.Context, req SnapRequest) (SnapResponse, error)
	GetStatus(ctx context.Context, orderID string) (Status, error)
	Cancel(ctx context.Context, orderID string) error
	Refund(ctx context.Context, orderID, refundKey string, amount int64, reason string) error
	VerifySignature(orderID, statusCode, grossAmount, signature string) bool
	ClientKey() string
	SnapJSURL() string
}

var (
	ErrNotConfigured = errors.New("midtrans is not configured")
	ErrNotFound      = errors.New("midtrans transaction not found")
)

// enabledPayments maps internal method codes to Snap's enabled_payments values.
var enabledPayments = map[string]string{
	"CREDIT_CARD": "credit_card",
	"QRIS":        "other_qris",
	"BCA_VA":      "bca_va",
	"BNI_VA":      "bni_va",
	"BRI_VA":      "bri_va",
	"MANDIRI_VA":  "echannel",
	"PERMATA_VA":  "permata_va",
}

func SupportsProviderRefund(method string) bool { return method == "CREDIT_CARD" }

type Client struct {
	serverKey  string
	clientKey  string
	snapURL    string
	apiURL     string
	production bool
	http       *http.Client
}

func New(serverKey, clientKey, snapURL, apiURL string, production bool) *Client {
	return &Client{serverKey: serverKey, clientKey: clientKey, snapURL: snapURL, apiURL: strings.TrimRight(apiURL, "/"),
		production: production, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) ClientKey() string { return c.clientKey }

func (c *Client) SnapJSURL() string {
	if c.production {
		return "https://app.midtrans.com/snap/snap.js"
	}
	return "https://app.sandbox.midtrans.com/snap/snap.js"
}

func (c *Client) do(ctx context.Context, method, u string, body any, out any) (int, error) {
	if c.serverKey == "" {
		return 0, ErrNotConfigured
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rdr)
	if err != nil {
		return 0, err
	}
	req.SetBasicAuth(c.serverKey, "")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("midtrans request: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return res.StatusCode, err
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("decode midtrans response (status %d): %w", res.StatusCode, err)
		}
	}
	return res.StatusCode, nil
}

func (c *Client) CreateSnap(ctx context.Context, r SnapRequest) (SnapResponse, error) {
	ep, ok := enabledPayments[r.Method]
	if !ok {
		return SnapResponse{}, fmt.Errorf("unsupported method %s", r.Method)
	}
	loc := time.FixedZone("WIB", 7*3600)
	body := map[string]any{
		"transaction_details": map[string]any{"order_id": r.OrderID, "gross_amount": r.GrossAmount},
		"item_details":        r.Items,
		"customer_details":    r.Customer,
		"enabled_payments":    []string{ep},
		"credit_card":         map[string]any{"secure": true},
		"expiry": map[string]any{
			"start_time": time.Now().In(loc).Format("2006-01-02 15:04:05 -0700"),
			"unit":       "minute",
			"duration":   r.ExpiryMinutes,
		},
	}
	if r.FinishURL != "" {
		body["callbacks"] = map[string]string{"finish": r.FinishURL}
	}
	var out SnapResponse
	status, err := c.do(ctx, http.MethodPost, c.snapURL, body, &out)
	if err != nil {
		return out, err
	}
	if status != http.StatusCreated && status != http.StatusOK || out.Token == "" {
		return out, fmt.Errorf("snap create failed with status %d", status)
	}
	return out, nil
}

func (c *Client) GetStatus(ctx context.Context, orderID string) (Status, error) {
	var out Status
	status, err := c.do(ctx, http.MethodGet, c.apiURL+"/v2/"+url.PathEscape(orderID)+"/status", nil, &out)
	if err != nil {
		return out, err
	}
	if status == http.StatusNotFound || out.StatusCode == "404" {
		return out, ErrNotFound
	}
	if status >= 300 || out.TransactionStatus == "" {
		return out, fmt.Errorf("status api returned %d", status)
	}
	return out, nil
}

func (c *Client) Cancel(ctx context.Context, orderID string) error {
	var out struct {
		StatusCode string `json:"status_code"`
	}
	status, err := c.do(ctx, http.MethodPost, c.apiURL+"/v2/"+url.PathEscape(orderID)+"/cancel", map[string]any{}, &out)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound || out.StatusCode == "404" {
		return ErrNotFound
	}
	if out.StatusCode != "200" && out.StatusCode != "412" {
		return fmt.Errorf("cancel returned %s", out.StatusCode)
	}
	return nil
}

func (c *Client) Refund(ctx context.Context, orderID, refundKey string, amount int64, reason string) error {
	var out struct {
		StatusCode string `json:"status_code"`
	}
	_, err := c.do(ctx, http.MethodPost, c.apiURL+"/v2/"+url.PathEscape(orderID)+"/refund",
		map[string]any{"refund_key": refundKey, "amount": amount, "reason": reason}, &out)
	if err != nil {
		return err
	}
	if out.StatusCode != "200" {
		return fmt.Errorf("refund returned %s", out.StatusCode)
	}
	return nil
}

// VerifySignature checks signature_key = SHA512(order_id + status_code + gross_amount + server_key)
// with a constant-time comparison.
func (c *Client) VerifySignature(orderID, statusCode, grossAmount, signature string) bool {
	if c.serverKey == "" {
		return false
	}
	return VerifySignature(c.serverKey, orderID, statusCode, grossAmount, signature)
}

func Signature(serverKey, orderID, statusCode, grossAmount string) string {
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(sum[:])
}

func VerifySignature(serverKey, orderID, statusCode, grossAmount, signature string) bool {
	expected := Signature(serverKey, orderID, statusCode, grossAmount)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(signature))) == 1
}

// ParseAmount converts Midtrans "150000.00" into whole rupiah, rejecting fractional amounts.
func ParseAmount(s string) (int64, error) {
	whole, frac, _ := strings.Cut(s, ".")
	if strings.Trim(frac, "0") != "" {
		return 0, fmt.Errorf("fractional amount %q", s)
	}
	return strconv.ParseInt(whole, 10, 64)
}

type InternalStatus string

const (
	PaymentPending   InternalStatus = "PENDING"
	PaymentSucceeded InternalStatus = "SUCCEEDED"
	PaymentFailed    InternalStatus = "FAILED"
	PaymentExpired   InternalStatus = "EXPIRED"
	PaymentCancelled InternalStatus = "CANCELLED"
)

// MapStatus is the single place Midtrans states map to internal payment states. A card capture
// flagged "challenge" stays pending until the merchant accepts it.
func MapStatus(transactionStatus, fraudStatus string) InternalStatus {
	switch transactionStatus {
	case "capture":
		if fraudStatus == "accept" || fraudStatus == "" {
			return PaymentSucceeded
		}
		if fraudStatus == "deny" {
			return PaymentFailed
		}
		return PaymentPending
	case "settlement", "refund", "partial_refund", "chargeback", "partial_chargeback":
		return PaymentSucceeded
	case "pending", "authorize":
		return PaymentPending
	case "deny", "failure":
		return PaymentFailed
	case "cancel":
		return PaymentCancelled
	case "expire":
		return PaymentExpired
	}
	return PaymentPending
}
